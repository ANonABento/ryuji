/**
 * LinkedIn post scheduler — queue posts for future publishing.
 *
 * Uses SQLite for persistence + setTimeout for firing.
 * Similar pattern to ReminderScheduler in lib/reminders.ts.
 */

import { Database } from "bun:sqlite";
import type { LinkedInPostResult } from "../types.ts";
import type { LinkedInClient } from "./api.ts";
import type { LinkedInMonitor } from "./monitor.ts";

// --- Types ---

export interface ScheduledPost {
  id: number;
  text: string;
  mediaType: "text" | "image" | "link";
  imageUrl: string | null;
  linkUrl: string | null;
  linkTitle: string | null;
  linkDescription: string | null;
  firstComment: string | null;
  scheduledAt: string; // SQLite datetime
  status: "pending" | "posted" | "cancelled" | "failed";
  postUrn: string | null;
  createdAt: string;
  error: string | null;
}

// --- Scheduler ---

export class LinkedInScheduler {
  private db: Database;
  private client: LinkedInClient;
  private monitor: LinkedInMonitor | null;
  private timers: Map<number, Timer> = new Map();
  private onPost: ((post: ScheduledPost, result: LinkedInPostResult) => void) | null = null;
  private onError: ((post: ScheduledPost, error: string) => void) | null = null;

  constructor(dbPath: string, client: LinkedInClient, monitor: LinkedInMonitor | null) {
    this.db = new Database(dbPath);
    this.client = client;
    this.monitor = monitor;
    try {
      this.migrate();
      this.scheduleAll();
    } catch (e) {
      this.db.close();
      throw e;
    }
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS linkedin_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        media_type TEXT NOT NULL DEFAULT 'text',
        image_url TEXT,
        link_url TEXT,
        link_title TEXT,
        link_description TEXT,
        first_comment TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        post_urn TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        error TEXT
      )
    `);
  }

  /**
   * Schedule all pending posts on startup.
   */
  private scheduleAll(): void {
    const posts = this.db.query(
      "SELECT * FROM linkedin_queue WHERE status = 'pending'"
    ).all() as any[];

    for (const row of posts) {
      this.scheduleTimer(this.rowToPost(row));
    }
  }

  private rowToPost(row: any): ScheduledPost {
    return {
      id: row.id,
      text: row.text,
      mediaType: row.media_type,
      imageUrl: row.image_url,
      linkUrl: row.link_url,
      linkTitle: row.link_title,
      linkDescription: row.link_description,
      firstComment: row.first_comment,
      scheduledAt: row.scheduled_at,
      status: row.status,
      postUrn: row.post_urn,
      createdAt: row.created_at,
      error: row.error,
    };
  }

  private scheduleTimer(post: ScheduledPost): void {
    // Parse scheduled time
    const scheduledMs = new Date(post.scheduledAt + "Z").getTime();
    const now = Date.now();
    const delay = Math.max(0, scheduledMs - now);

    const timer = setTimeout(() => {
      this.timers.delete(post.id);
      this.firePost(post);
    }, delay);

    this.timers.set(post.id, timer);
  }

  private async firePost(post: ScheduledPost): Promise<void> {
    // Re-check status in case it was cancelled while timer was pending
    const current = this.db.query("SELECT status FROM linkedin_queue WHERE id = ?").get(post.id) as { status: string } | null;
    if (!current || current.status !== "pending") return;

    if (!this.client.isAuthenticated()) {
      this.markFailed(post.id, "Not authenticated with LinkedIn.");
      return;
    }

    try {
      let result: LinkedInPostResult;

      switch (post.mediaType) {
        case "image":
          if (!post.imageUrl) throw new Error("Image URL missing");
          result = await this.client.postWithImage(post.text, post.imageUrl);
          break;
        case "link":
          if (!post.linkUrl) throw new Error("Link URL missing");
          result = await this.client.postWithLink(
            post.text,
            post.linkUrl,
            post.linkTitle ?? undefined,
            post.linkDescription ?? undefined
          );
          break;
        default:
          result = await this.client.post(post.text);
      }

      // Track for comment monitoring
      if (this.monitor && result.id) {
        this.monitor.trackPost(result.id, post.text);
      }

      // Post first comment if set
      if (post.firstComment && result.id) {
        try {
          await this.client.commentOnPost(result.id, post.firstComment);
        } catch (e: any) {
          console.error(`[LinkedIn Scheduler] First comment failed: ${e.message}`);
        }
      }

      // Mark as posted
      this.db.run(
        "UPDATE linkedin_queue SET status = 'posted', post_urn = ? WHERE id = ?",
        [result.id, post.id]
      );

      const updatedPost = { ...post, status: "posted" as const, postUrn: result.id };
      this.onPost?.(updatedPost, result);
    } catch (e: any) {
      this.markFailed(post.id, e.message);
      this.onError?.({ ...post, status: "failed", error: e.message }, e.message);
    }
  }

  private markFailed(id: number, error: string): void {
    this.db.run(
      "UPDATE linkedin_queue SET status = 'failed', error = ? WHERE id = ?",
      [error, id]
    );
  }

  /**
   * Set callback for when a scheduled post is published.
   */
  onPosted(callback: (post: ScheduledPost, result: LinkedInPostResult) => void): void {
    this.onPost = callback;
  }

  /**
   * Set callback for when a scheduled post fails.
   */
  onFailed(callback: (post: ScheduledPost, error: string) => void): void {
    this.onError = callback;
  }

  /**
   * Schedule a new post.
   */
  schedule(opts: {
    text: string;
    scheduledAt: string; // SQLite datetime format
    mediaType?: "text" | "image" | "link";
    imageUrl?: string;
    linkUrl?: string;
    linkTitle?: string;
    linkDescription?: string;
    firstComment?: string;
  }): ScheduledPost {
    const result = this.db.run(
      `INSERT INTO linkedin_queue (text, media_type, image_url, link_url, link_title, link_description, first_comment, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.text,
        opts.mediaType || "text",
        opts.imageUrl || null,
        opts.linkUrl || null,
        opts.linkTitle || null,
        opts.linkDescription || null,
        opts.firstComment || null,
        opts.scheduledAt,
      ]
    );

    const id = Number(result.lastInsertRowid);
    const post = this.db.query("SELECT * FROM linkedin_queue WHERE id = ?").get(id) as any;
    const scheduled = this.rowToPost(post);

    this.scheduleTimer(scheduled);
    return scheduled;
  }

  /**
   * Cancel a scheduled post.
   */
  cancel(id: number): boolean {
    const post = this.db.query(
      "SELECT * FROM linkedin_queue WHERE id = ? AND status = 'pending'"
    ).get(id) as any;

    if (!post) return false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.db.run("UPDATE linkedin_queue SET status = 'cancelled' WHERE id = ?", [id]);
    return true;
  }

  /**
   * Get all scheduled posts (pending by default).
   */
  getQueue(includeAll: boolean = false): ScheduledPost[] {
    const query = includeAll
      ? "SELECT * FROM linkedin_queue ORDER BY scheduled_at ASC"
      : "SELECT * FROM linkedin_queue WHERE status = 'pending' ORDER BY scheduled_at ASC";
    return (this.db.query(query).all() as any[]).map((r) => this.rowToPost(r));
  }

  /**
   * Cleanup — clear all timers and close DB.
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.db.close();
  }
}
