import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../lib/memory.ts";

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
