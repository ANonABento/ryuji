import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { dateToSQLite } from "@choomfie/shared";

import { SocialScheduler } from "../providers/scheduler.ts";
import type {
  LinkedInPayload,
  Poster,
  PublishResult,
  RedditPayload,
  SchedulePayload,
  TwitterPayload,
} from "../providers/scheduler-types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    }),
  );
});

async function tmpDb(prefix = "choomfie-scheduler-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, "scheduler.db");
}

function makeMockPoster(opts?: {
  authenticated?: boolean;
  fail?: string;
  onPublish?: (payload: SchedulePayload) => void;
}): Poster & { calls: SchedulePayload[] } {
  const calls: SchedulePayload[] = [];
  return {
    calls,
    isAuthenticated() {
      return opts?.authenticated !== false;
    },
    async publish(payload): Promise<PublishResult> {
      calls.push(payload);
      opts?.onPublish?.(payload);
      if (opts?.fail) throw new Error(opts.fail);
      return { id: `mock-${calls.length}`, url: `https://mock/${calls.length}` };
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function lp(text: string): LinkedInPayload {
  return { kind: "linkedin", text, mediaType: "text" };
}

test("creates social_queue table on construction", async () => {
  const dbPath = await tmpDb();
  const scheduler = new SocialScheduler({ dbPath, posters: {} });

  // Inspect via a side DB handle
  scheduler.destroy();
  const db = new Database(dbPath);
  const cols = db.query("PRAGMA table_info(social_queue)").all() as { name: string }[];
  db.close();
  const names = cols.map((c) => c.name).sort();
  expect(names).toContain("id");
  expect(names).toContain("provider");
  expect(names).toContain("payload");
  expect(names).toContain("scheduled_at");
  expect(names).toContain("status");
  expect(names).toContain("provider_post_id");
  expect(names).toContain("provider_post_url");
  expect(names).toContain("error");
  expect(names).toContain("created_at");
});

test("schedules a pending post and fires it", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster();
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  const scheduledAt = dateToSQLite(new Date(Date.now() + 80));
  const post = scheduler.schedule({
    provider: "linkedin",
    payload: lp("hello"),
    scheduledAt,
  });
  expect(post.status).toBe("pending");

  await sleep(200);

  expect(linkedin.calls).toHaveLength(1);
  const queue = scheduler.getQueue({ includeAll: true });
  expect(queue[0].status).toBe("posted");
  expect(queue[0].providerPostId).toBe("mock-1");
  expect(queue[0].providerPostUrl).toBe("https://mock/1");
  scheduler.destroy();
});

test("re-schedules pending rows on construction", async () => {
  const dbPath = await tmpDb();

  // Pre-populate via raw DB
  {
    const seed = new SocialScheduler({ dbPath, posters: {} });
    seed.destroy();
  }
  const db = new Database(dbPath);
  const scheduledAt = dateToSQLite(new Date(Date.now() + 60));
  db.run(
    "INSERT INTO social_queue (provider, payload, scheduled_at) VALUES (?, ?, ?)",
    ["linkedin", JSON.stringify(lp("from-disk")), scheduledAt],
  );
  db.close();

  const linkedin = makeMockPoster();
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });
  expect(scheduler.timerCount).toBe(1);

  await sleep(200);
  expect(linkedin.calls).toHaveLength(1);
  scheduler.destroy();
});

test("cancel removes timer and marks row cancelled", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster();
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  const scheduledAt = dateToSQLite(new Date(Date.now() + 60 * 60 * 1000));
  const post = scheduler.schedule({
    provider: "linkedin",
    payload: lp("future"),
    scheduledAt,
  });

  expect(scheduler.cancel(post.id)).toBe(true);
  expect(scheduler.timerCount).toBe(0);
  expect(scheduler.cancel(post.id)).toBe(false);

  const queue = scheduler.getQueue({ includeAll: true });
  expect(queue[0].status).toBe("cancelled");
  expect(linkedin.calls).toHaveLength(0);
  scheduler.destroy();
});

test("publish failure marks row failed and invokes onFailed", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster({ fail: "boom" });
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  const failures: { id: number; error: string }[] = [];
  scheduler.onFailed((post, error) => {
    failures.push({ id: post.id, error });
  });

  const post = scheduler.schedule({
    provider: "linkedin",
    payload: lp("fails"),
    scheduledAt: dateToSQLite(new Date(Date.now() + 50)),
  });

  await sleep(200);

  const queue = scheduler.getQueue({ includeAll: true });
  expect(queue[0].status).toBe("failed");
  expect(queue[0].error).toBe("boom");
  expect(failures.length).toBe(1);
  expect(failures[0].id).toBe(post.id);
  expect(failures[0].error).toBe("boom");
  scheduler.destroy();
});

test("provider routing dispatches each payload to its own poster", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster();
  const twitter = makeMockPoster();
  const reddit = makeMockPoster();
  const scheduler = new SocialScheduler({
    dbPath,
    posters: { linkedin, twitter, reddit },
  });

  const li: LinkedInPayload = { kind: "linkedin", text: "li", mediaType: "text" };
  const tw: TwitterPayload = { kind: "twitter", variant: "tweet", text: "tw" };
  const rd: RedditPayload = {
    kind: "reddit",
    subreddit: "test",
    title: "rd",
    variant: "self",
    text: "body",
  };
  const at = (offsetMs: number) => dateToSQLite(new Date(Date.now() + offsetMs));

  scheduler.schedule({ provider: "linkedin", payload: li, scheduledAt: at(40) });
  scheduler.schedule({ provider: "twitter", payload: tw, scheduledAt: at(60) });
  scheduler.schedule({ provider: "reddit", payload: rd, scheduledAt: at(80) });

  await sleep(250);

  expect(linkedin.calls).toHaveLength(1);
  expect(twitter.calls).toHaveLength(1);
  expect(reddit.calls).toHaveLength(1);
  expect((linkedin.calls[0] as LinkedInPayload).text).toBe("li");
  expect((twitter.calls[0] as TwitterPayload).text).toBe("tw");
  expect((reddit.calls[0] as RedditPayload).title).toBe("rd");
  scheduler.destroy();
});

test("migrates rows from legacy linkedin_queue table idempotently", async () => {
  const dbPath = await tmpDb();

  // Seed legacy table BEFORE constructing the scheduler
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE linkedin_queue (
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
  const future = dateToSQLite(new Date(Date.now() + 60 * 60 * 1000));
  db.run(
    "INSERT INTO linkedin_queue (text, scheduled_at, status) VALUES (?, ?, ?)",
    ["pending-1", future, "pending"],
  );
  db.run(
    "INSERT INTO linkedin_queue (text, scheduled_at, status) VALUES (?, ?, ?)",
    ["pending-2", future, "pending"],
  );
  db.run(
    "INSERT INTO linkedin_queue (text, scheduled_at, status, post_urn) VALUES (?, ?, ?, ?)",
    ["already-posted", future, "posted", "urn:li:share:1"],
  );
  db.close();

  // First construction migrates rows
  const linkedin = makeMockPoster();
  const scheduler1 = new SocialScheduler({ dbPath, posters: { linkedin } });
  const all1 = scheduler1.getQueue({ includeAll: true });
  expect(all1.length).toBe(3);
  const texts1 = all1.map((p) => (p.payload as LinkedInPayload).text).sort();
  expect(texts1).toEqual(["already-posted", "pending-1", "pending-2"]);
  const postedRow = all1.find(
    (p) => (p.payload as LinkedInPayload).text === "already-posted",
  );
  expect(postedRow?.status).toBe("posted");
  expect(postedRow?.providerPostId).toBe("urn:li:share:1");
  scheduler1.destroy();

  // Re-construct — must not duplicate
  const scheduler2 = new SocialScheduler({ dbPath, posters: { linkedin } });
  const all2 = scheduler2.getQueue({ includeAll: true });
  expect(all2.length).toBe(3);

  // Verify legacy rows flagged as migrated
  const verify = new Database(dbPath);
  const flagged = verify
    .query("SELECT COUNT(*) as c FROM linkedin_queue WHERE migrated = 1")
    .get() as { c: number };
  verify.close();
  expect(flagged.c).toBe(3);
  scheduler2.destroy();
});

test("missing poster fails the scheduled row with a clear error", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster();
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  const failures: string[] = [];
  scheduler.onFailed((_post, error) => {
    failures.push(error);
  });

  scheduler.schedule({
    provider: "twitter",
    payload: { kind: "twitter", variant: "tweet", text: "no poster" },
    scheduledAt: dateToSQLite(new Date(Date.now() + 50)),
  });

  await sleep(200);

  const queue = scheduler.getQueue({ includeAll: true });
  expect(queue[0].status).toBe("failed");
  expect(queue[0].error).toContain("twitter poster not registered");
  expect(failures.length).toBe(1);
  expect(failures[0]).toContain("twitter poster not registered");
  scheduler.destroy();
});

test("unauthenticated poster fails before publish is called", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster({ authenticated: false });
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  scheduler.schedule({
    provider: "linkedin",
    payload: lp("auth-needed"),
    scheduledAt: dateToSQLite(new Date(Date.now() + 50)),
  });

  await sleep(200);

  expect(linkedin.calls).toHaveLength(0);
  const queue = scheduler.getQueue({ includeAll: true });
  expect(queue[0].status).toBe("failed");
  expect(queue[0].error).toContain("Not authenticated with linkedin");
  scheduler.destroy();
});

test("destroy clears timers and closes db handle", async () => {
  const dbPath = await tmpDb();
  const linkedin = makeMockPoster();
  const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

  for (let i = 0; i < 5; i++) {
    scheduler.schedule({
      provider: "linkedin",
      payload: lp(`#${i}`),
      scheduledAt: dateToSQLite(new Date(Date.now() + 60 * 60 * 1000)),
    });
  }
  expect(scheduler.timerCount).toBe(5);

  scheduler.destroy();
  expect(scheduler.timerCount).toBe(0);

  // Re-open the file independently — it should still be a valid SQLite file
  const db = new Database(dbPath);
  const cnt = db.query("SELECT COUNT(*) as c FROM social_queue").get() as { c: number };
  db.close();
  expect(cnt.c).toBe(5);
});

test("setLongTimeout chains for delays beyond the 24.8-day cap", async () => {
  const dbPath = await tmpDb();
  const originalSetTimeout = globalThis.setTimeout;
  const observed: number[] = [];
  // Patch globalThis.setTimeout to record delays without actually waiting
  (globalThis as any).setTimeout = ((fn: any, delay: number, ...rest: any[]) => {
    observed.push(delay);
    return originalSetTimeout(fn, 1_000_000, ...rest); // schedule far enough out to never fire in test
  }) as any;
  try {
    const linkedin = makeMockPoster();
    const scheduler = new SocialScheduler({ dbPath, posters: { linkedin } });

    // 30 days in the future
    const farFuture = dateToSQLite(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    scheduler.schedule({
      provider: "linkedin",
      payload: lp("far-future"),
      scheduledAt: farFuture,
    });

    expect(scheduler.timerCount).toBe(1);
    // Most recent setTimeout call must be clamped to the 32-bit cap
    const lastDelay = observed[observed.length - 1];
    expect(lastDelay).toBe(2_147_483_647);
    scheduler.destroy();
  } finally {
    (globalThis as any).setTimeout = originalSetTimeout;
  }
});
