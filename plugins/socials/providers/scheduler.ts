/**
 * Provider-agnostic social media post scheduler.
 *
 * One SQLite-backed queue + one timer map handles linkedin/twitter/reddit.
 * Per-provider poster adapters (`Poster`) translate generic rows into API calls.
 *
 * Single-instance assumption: the supervisor PID guard prevents two workers
 * from sharing this DB. Copying the DB file on disk would cause duplicate fires.
 */

import { Database } from "bun:sqlite";
import { fromSQLiteDatetime } from "@choomfie/shared";
import type {
  PosterRegistry,
  Provider,
  PublishResult,
  ScheduledPost,
  ScheduleStatus,
  SchedulePayload,
} from "./scheduler-types.ts";

const MAX_TIMEOUT_MS = 2_147_483_647; // setTimeout silently caps here (~24.8 days)

interface SocialQueueRow {
  id: number;
  provider: string;
  payload: string;
  scheduled_at: string;
  status: string;
  provider_post_id: string | null;
  provider_post_url: string | null;
  error: string | null;
  created_at: string;
}

interface LinkedInQueueRow {
  id: number;
  text: string;
  media_type: string;
  image_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_description: string | null;
  first_comment: string | null;
  scheduled_at: string;
  status: string;
  post_urn: string | null;
  created_at: string;
  error: string | null;
}

export class SocialScheduler {
  private db: Database;
  private posters: PosterRegistry;
  private timers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private onPost: ((post: ScheduledPost, result: PublishResult) => void) | null = null;
  private onError: ((post: ScheduledPost, error: string) => void) | null = null;

  constructor(opts: { dbPath: string; posters: PosterRegistry }) {
    this.db = new Database(opts.dbPath);
    this.posters = opts.posters;
    try {
      this.migrate();
      this.migrateFromLinkedInQueue();
      this.scheduleAll();
    } catch (e) {
      this.db.close();
      throw e;
    }
  }

  /** Replace the registered posters (used when providers come online late). */
  setPosters(posters: PosterRegistry): void {
    this.posters = posters;
  }

  // --- Migrations ---

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS social_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        payload TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        provider_post_id TEXT,
        provider_post_url TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * One-shot migration from the legacy `linkedin_queue` table.
   *
   * Idempotent: each row is flagged `migrated=1` after a successful copy, so
   * a mid-migration crash is resumable. The legacy table is preserved for
   * rollback — drop in a follow-up release.
   */
  private migrateFromLinkedInQueue(): void {
    // Detect legacy table — if missing, nothing to migrate
    const tables = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='linkedin_queue'")
      .all() as { name: string }[];
    if (tables.length === 0) return;

    // Add per-row migration flag if missing
    const cols = this.db.query("PRAGMA table_info(linkedin_queue)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "migrated")) {
      this.db.run("ALTER TABLE linkedin_queue ADD COLUMN migrated INTEGER DEFAULT 0");
    }

    const rows = this.db
      .query("SELECT * FROM linkedin_queue WHERE migrated = 0 OR migrated IS NULL")
      .all() as LinkedInQueueRow[];

    for (const row of rows) {
      const payload = {
        kind: "linkedin" as const,
        text: row.text,
        mediaType: (row.media_type as "text" | "image" | "link") || "text",
        imageUrl: row.image_url ?? undefined,
        linkUrl: row.link_url ?? undefined,
        linkTitle: row.link_title ?? undefined,
        linkDescription: row.link_description ?? undefined,
        firstComment: row.first_comment ?? undefined,
      };
      this.db.run(
        `INSERT INTO social_queue
           (provider, payload, scheduled_at, status, provider_post_id, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "linkedin",
          JSON.stringify(payload),
          row.scheduled_at,
          row.status,
          row.post_urn,
          row.error,
          row.created_at,
        ],
      );
      this.db.run("UPDATE linkedin_queue SET migrated = 1 WHERE id = ?", [row.id]);
    }
  }

  // --- Scheduling ---

  private scheduleAll(): void {
    const rows = this.db
      .query("SELECT * FROM social_queue WHERE status = 'pending'")
      .all() as SocialQueueRow[];
    for (const row of rows) {
      const post = this.rowToPost(row);
      if (post) this.scheduleTimer(post);
    }
  }

  private rowToPost(row: SocialQueueRow): ScheduledPost | null {
    let payload: SchedulePayload;
    try {
      payload = JSON.parse(row.payload) as SchedulePayload;
    } catch (e: any) {
      this.markFailed(row.id, `Malformed payload: ${e.message}`);
      return null;
    }
    return {
      id: row.id,
      provider: row.provider as Provider,
      payload,
      scheduledAt: row.scheduled_at,
      status: row.status as ScheduleStatus,
      providerPostId: row.provider_post_id,
      providerPostUrl: row.provider_post_url,
      error: row.error,
      createdAt: row.created_at,
    };
  }

  private scheduleTimer(post: ScheduledPost): void {
    const targetMs = fromSQLiteDatetime(post.scheduledAt).getTime();
    this.setLongTimeout(post.id, targetMs, () => {
      void this.firePost(post);
    });
  }

  /**
   * setTimeout silently clamps at MAX_TIMEOUT_MS (~24.8 days). For longer
   * delays, re-arm recursively until the remaining wait fits.
   */
  private setLongTimeout(id: number, targetMs: number, onElapsed: () => void): void {
    const remainingMs = targetMs - Date.now();
    const delayMs = Math.max(0, Math.min(remainingMs, MAX_TIMEOUT_MS));

    const timer = setTimeout(() => {
      this.timers.delete(id);
      if (targetMs > Date.now()) {
        this.setLongTimeout(id, targetMs, onElapsed);
        return;
      }
      onElapsed();
    }, delayMs);

    this.timers.set(id, timer);
  }

  private async firePost(post: ScheduledPost): Promise<void> {
    // Re-check status — guard against cancel-while-pending race
    const current = this.db
      .query("SELECT status FROM social_queue WHERE id = ?")
      .get(post.id) as { status: string } | null;
    if (!current || current.status !== "pending") return;

    const poster = this.posters[post.provider];
    if (!poster) {
      const msg = `${post.provider} poster not registered (check config.json)`;
      this.markFailed(post.id, msg);
      this.onError?.({ ...post, status: "failed", error: msg }, msg);
      return;
    }

    if (!poster.isAuthenticated()) {
      const msg = `Not authenticated with ${post.provider}, run ${post.provider}_auth.`;
      this.markFailed(post.id, msg);
      this.onError?.({ ...post, status: "failed", error: msg }, msg);
      return;
    }

    try {
      const result = await poster.publish(post.payload);
      this.db.run(
        "UPDATE social_queue SET status = 'posted', provider_post_id = ?, provider_post_url = ? WHERE id = ?",
        [result.id, result.url ?? null, post.id],
      );
      const updated: ScheduledPost = {
        ...post,
        status: "posted",
        providerPostId: result.id,
        providerPostUrl: result.url ?? null,
      };
      this.onPost?.(updated, result);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.markFailed(post.id, msg);
      this.onError?.({ ...post, status: "failed", error: msg }, msg);
    }
  }

  private markFailed(id: number, error: string): void {
    this.db.run("UPDATE social_queue SET status = 'failed', error = ? WHERE id = ?", [error, id]);
  }

  // --- Public API ---

  onPosted(callback: (post: ScheduledPost, result: PublishResult) => void): void {
    this.onPost = callback;
  }

  onFailed(callback: (post: ScheduledPost, error: string) => void): void {
    this.onError = callback;
  }

  schedule(opts: {
    provider: Provider;
    payload: SchedulePayload;
    scheduledAt: string;
  }): ScheduledPost {
    const result = this.db.run(
      `INSERT INTO social_queue (provider, payload, scheduled_at) VALUES (?, ?, ?)`,
      [opts.provider, JSON.stringify(opts.payload), opts.scheduledAt],
    );
    const id = Number(result.lastInsertRowid);
    const row = this.db.query("SELECT * FROM social_queue WHERE id = ?").get(id) as SocialQueueRow;
    const post = this.rowToPost(row);
    if (!post) throw new Error("Failed to load freshly inserted scheduled post");
    this.scheduleTimer(post);
    return post;
  }

  cancel(id: number): boolean {
    const row = this.db
      .query("SELECT id FROM social_queue WHERE id = ? AND status = 'pending'")
      .get(id) as { id: number } | null;
    if (!row) return false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.db.run("UPDATE social_queue SET status = 'cancelled' WHERE id = ?", [id]);
    return true;
  }

  /** Return scheduled posts. By default only `pending`; pass `includeAll` for everything. */
  getQueue(opts?: { includeAll?: boolean; provider?: Provider }): ScheduledPost[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!opts?.includeAll) where.push("status = 'pending'");
    if (opts?.provider) {
      where.push("provider = ?");
      params.push(opts.provider);
    }
    const sql =
      `SELECT * FROM social_queue` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY scheduled_at ASC`;
    const rows = this.db.query(sql).all(...params) as SocialQueueRow[];
    return rows.map((r) => this.rowToPost(r)).filter((p): p is ScheduledPost => p !== null);
  }

  /** Test-only accessor for the active timer count. */
  get timerCount(): number {
    return this.timers.size;
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.db.close();
  }
}
