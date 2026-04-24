import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../lib/memory.ts";
import { MS_PER_DAY, MS_PER_HOUR, dateToSQLite } from "../lib/time.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {}
    })
  );
});

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-memory-"));
  tempDirs.push(dir);
  return new MemoryStore(join(dir, "memory.db"));
}

test("memory store saves and updates core memories", async () => {
  const store = await createStore();

  store.setCoreMemory("timezone", "UTC");
  store.setCoreMemory("nickname", "choom");
  store.setCoreMemory("timezone", "America/Montevideo");

  const memories = store.getCoreMemory();
  store.close();

  expect(memories).toHaveLength(2);
  expect(memories).toContainEqual(
    expect.objectContaining({
      key: "timezone",
      value: "America/Montevideo",
    })
  );
  expect(memories).toContainEqual(
    expect.objectContaining({
      key: "nickname",
      value: "choom",
    })
  );
});

test("memory store searches archival memories by content", async () => {
  const store = await createStore();

  store.addArchival("Discuss quarterly planning and roadmap", "work");
  store.addArchival("Remember to buy coffee beans", "personal");
  store.addArchival("Coffee chat notes with mentor", "work");

  const results = store.searchArchival("coffee");
  store.close();

  expect(results).toHaveLength(2);
  expect(results.map((item) => item.content)).toEqual(
    expect.arrayContaining([
      "Remember to buy coffee beans",
      "Coffee chat notes with mentor",
    ])
  );
});

test("memory store auto-archives overflowed core memories", async () => {
  const store = await createStore();

  for (let i = 0; i < MemoryStore.MAX_CORE_MEMORIES + 2; i += 1) {
    store.setCoreMemory(`key-${i}`, `value-${i}`);
  }

  const stats = store.getStats();
  const archived = store.searchArchival("[auto-archived]", 10);
  store.close();

  expect(stats.coreCount).toBe(MemoryStore.MAX_CORE_MEMORIES);
  expect(stats.archivalCount).toBe(2);
  expect(archived).toHaveLength(2);
  expect(archived.every((entry) => entry.content.startsWith("[auto-archived]"))).toBe(true);
});

test("addArchival round-trips content, tags, and createdAt", async () => {
  const store = await createStore();

  store.addArchival("Plan weekend trip", "travel,personal");
  store.addArchival("Untagged note");

  const tagged = store.searchArchival("weekend");
  const untagged = store.searchArchival("Untagged");
  store.close();

  expect(tagged).toHaveLength(1);
  expect(tagged[0]?.tags).toBe("travel,personal");
  expect(tagged[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(untagged[0]?.tags).toBe("");
});

test("searchArchival honors limit and orders DESC by created_at", async () => {
  const store = await createStore();
  const db = (store as any).db as import("bun:sqlite").Database;

  for (let i = 0; i < 5; i += 1) {
    store.addArchival(`entry-${i}`);
  }
  // Stamp deterministic created_at so ordering is unambiguous
  for (let i = 0; i < 5; i += 1) {
    db.query("UPDATE archival_memory SET created_at = ? WHERE content = ?")
      .run(`2026-01-0${i + 1} 12:00:00`, `entry-${i}`);
  }

  const results = store.searchArchival("entry", 3);
  store.close();

  expect(results).toHaveLength(3);
  expect(results.map((r) => r.content)).toEqual(["entry-4", "entry-3", "entry-2"]);
});

test("deleteCoreMemory removes a single key", async () => {
  const store = await createStore();

  store.setCoreMemory("keep", "yes");
  store.setCoreMemory("drop", "bye");
  store.deleteCoreMemory("drop");

  const keys = store.getCoreMemory().map((m) => m.key);
  store.close();

  expect(keys).toEqual(["keep"]);
});

test("reminder CRUD round-trips options and filters by user", async () => {
  const store = await createStore();

  const dueAt = dateToSQLite(new Date(Date.now() + MS_PER_HOUR));
  const id = store.addReminder("user-a", "chan-1", "Pay rent", dueAt, {
    cron: "monthly",
    nagInterval: 15,
    category: "bills",
  });

  const reminder = store.getReminder(id);
  const mine = store.getActiveReminders("user-a");
  const theirs = store.getActiveReminders("user-b");
  store.close();

  expect(reminder).toMatchObject({
    id,
    userId: "user-a",
    chatId: "chan-1",
    message: "Pay rent",
    cron: "monthly",
    nagInterval: 15,
    category: "bills",
    ack: 0,
    lastNagAt: null,
  });
  expect(mine).toHaveLength(1);
  expect(mine[0]?.id).toBe(id);
  expect(theirs).toHaveLength(0);
});

test("getDueReminders returns only past-due, unfired rows", async () => {
  const store = await createStore();

  const yesterday = dateToSQLite(new Date(Date.now() - MS_PER_DAY));
  const tomorrow = dateToSQLite(new Date(Date.now() + MS_PER_DAY));
  const pastUnfired = store.addReminder("u", "c", "past unfired", yesterday);
  store.addReminder("u", "c", "future", tomorrow);
  const pastFired = store.addReminder("u", "c", "past fired", yesterday);
  store.markReminderFired(pastFired);

  const due = store.getDueReminders();
  store.close();

  expect(due).toHaveLength(1);
  expect(due[0]?.id).toBe(pastUnfired);
});

test("ackReminder is false before fire and true after", async () => {
  const store = await createStore();

  const id = store.addReminder("u", "c", "m", dateToSQLite(new Date()));
  const beforeFire = store.ackReminder(id);
  store.markReminderFired(id);
  const afterFire = store.ackReminder(id);
  store.close();

  expect(beforeFire).toBe(false);
  expect(afterFire).toBe(true);
});

test("cancelReminder guards against fired+acked reminders", async () => {
  const store = await createStore();
  const dueAt = dateToSQLite(new Date());

  const unfiredId = store.addReminder("u", "c", "a", dueAt);
  const firedUnackedId = store.addReminder("u", "c", "b", dueAt);
  store.markReminderFired(firedUnackedId);
  const firedAckedId = store.addReminder("u", "c", "c", dueAt);
  store.markReminderFired(firedAckedId);
  store.ackReminder(firedAckedId);

  const unfiredResult = store.cancelReminder(unfiredId);
  const firedUnackedResult = store.cancelReminder(firedUnackedId);
  const firedAckedResult = store.cancelReminder(firedAckedId);
  const firedAckedStillPresent = store.getReminder(firedAckedId);
  store.close();

  expect(unfiredResult).toBe(true);
  expect(firedUnackedResult).toBe(true);
  expect(firedAckedResult).toBe(false);
  expect(firedAckedStillPresent).not.toBeNull();
});

test("snoozeReminder resets fired, ack, lastNagAt, and dueAt", async () => {
  const store = await createStore();

  const id = store.addReminder("u", "c", "m", dateToSQLite(new Date()), { nagInterval: 5 });
  store.markReminderFired(id);
  store.ackReminder(id);
  store.updateNagTime(id);

  const newDueAt = dateToSQLite(new Date(Date.now() + MS_PER_HOUR));
  const ok = store.snoozeReminder(id, newDueAt);
  const after = store.getReminder(id);
  const active = store.getActiveReminders();
  store.close();

  expect(ok).toBe(true);
  expect(after?.ack).toBe(0);
  expect(after?.lastNagAt).toBeNull();
  expect(after?.dueAt).toBe(newDueAt);
  // getActiveReminders filters fired=0, so appearance there proves snooze cleared fired
  expect(active.map((r) => r.id)).toContain(id);
});

test("purgeOldReminders deletes only fired+acked rows past the threshold", async () => {
  const store = await createStore();
  const db = (store as any).db as import("bun:sqlite").Database;
  const dueAt = dateToSQLite(new Date());

  const oldAcked = store.addReminder("u", "c", "old acked", dueAt);
  const recentAcked = store.addReminder("u", "c", "recent acked", dueAt);
  const oldUnacked = store.addReminder("u", "c", "old unacked", dueAt);

  db.query(
    "UPDATE reminders SET fired = 1, ack = 1, due_at = datetime('now', '-8 days') WHERE id = ?"
  ).run(oldAcked);
  db.query(
    "UPDATE reminders SET fired = 1, ack = 1, due_at = datetime('now', '-3 days') WHERE id = ?"
  ).run(recentAcked);
  db.query(
    "UPDATE reminders SET fired = 1, ack = 0, due_at = datetime('now', '-30 days') WHERE id = ?"
  ).run(oldUnacked);

  const deleted = store.purgeOldReminders(7);
  const remaining = {
    oldAcked: store.getReminder(oldAcked),
    recentAcked: store.getReminder(recentAcked),
    oldUnacked: store.getReminder(oldUnacked),
  };
  store.close();

  expect(deleted).toBe(1);
  expect(remaining.oldAcked).toBeNull();
  expect(remaining.recentAcked).not.toBeNull();
  expect(remaining.oldUnacked).not.toBeNull();
});

test("getNagReminders respects the nag_interval window", async () => {
  const store = await createStore();
  const db = (store as any).db as import("bun:sqlite").Database;
  const dueAt = dateToSQLite(new Date());

  // Window elapsed: last_nag_at far in the past
  const elapsedId = store.addReminder("u", "c", "elapsed nag", dueAt, { nagInterval: 5 });
  store.markReminderFired(elapsedId);
  db.query("UPDATE reminders SET last_nag_at = '2000-01-01 00:00:00' WHERE id = ?").run(elapsedId);

  // Window not yet elapsed: last_nag_at just set to now by markReminderFired, interval 60m
  const pendingId = store.addReminder("u", "c", "pending nag", dueAt, { nagInterval: 60 });
  store.markReminderFired(pendingId);

  const nags = store.getNagReminders();
  store.close();

  expect(nags).toHaveLength(1);
  expect(nags[0]?.id).toBe(elapsedId);
});

test("getStats returns zeros for an empty store and exact counts after seeding", async () => {
  const store = await createStore();

  const empty = store.getStats();
  store.setCoreMemory("k1", "v1");
  store.setCoreMemory("k2", "v2");
  store.addArchival("a");
  store.addReminder("u", "c", "m", dateToSQLite(new Date(Date.now() + MS_PER_HOUR)));
  const seeded = store.getStats();
  store.close();

  expect(empty).toMatchObject({
    coreCount: 0,
    archivalCount: 0,
    reminderCount: 0,
    oldestMemory: null,
    newestMemory: null,
  });
  expect(seeded.coreCount).toBe(2);
  expect(seeded.archivalCount).toBe(1);
  expect(seeded.reminderCount).toBe(1);
  expect(seeded.oldestMemory).not.toBeNull();
  expect(seeded.newestMemory).not.toBeNull();
});

test("buildMemoryContext formats core memories and returns empty when none", async () => {
  const store = await createStore();

  expect(store.buildMemoryContext()).toBe("");

  store.setCoreMemory("timezone", "UTC");
  store.setCoreMemory("nick", "choom");
  const context = store.buildMemoryContext();
  store.close();

  expect(context).toContain("## Current Memories");
  expect(context).toContain("- timezone: UTC");
  expect(context).toContain("- nick: choom");
});

test("close() closes the underlying database so further queries throw", async () => {
  const store = await createStore();

  store.setCoreMemory("k", "v");
  store.close();

  expect(() => store.getCoreMemory()).toThrow();
});
