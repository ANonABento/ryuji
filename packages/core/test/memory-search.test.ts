import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddingProvider, MemoryStore } from "../lib/memory.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeMemory(embeddingProvider: EmbeddingProvider | null): Promise<MemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-memory-search-"));
  tempDirs.push(dir);
  return new MemoryStore(join(dir, "choomfie.db"), { embeddingProvider });
}

const fakeEmbeddingProvider: EmbeddingProvider = {
  name: "test",
  model: "keywords",
  embed(text: string): number[] | null {
    const normalized = text.toLowerCase();
    const carScore = ["car", "cars", "drive", "road", "automobile", "trip"].some((word) =>
      normalized.includes(word)
    )
      ? 1
      : 0;
    const foodScore = ["recipe", "food", "cook", "dinner", "pasta"].some((word) =>
      normalized.includes(word)
    )
      ? 1
      : 0;
    return [carScore, foodScore];
  },
};

test("searchArchival ranks archival memories by semantic embedding similarity", async () => {
  const memory = await makeMemory(fakeEmbeddingProvider);

  memory.addArchival("Good pasta dough needs enough resting time.", "cooking");
  memory.addArchival("Road trip notes: charge the car before leaving.", "travel");

  const results = memory.searchArchival("automobile journey", 2);

  expect(results).toHaveLength(2);
  expect(results[0].content).toContain("Road trip");
  expect(results[0].score).toBeGreaterThan(results[1].score ?? 0);

  memory.close();
});

test("searchArchival falls back to string matching when embeddings are disabled", async () => {
  const memory = await makeMemory(null);

  memory.addArchival("Road trip notes: charge the car before leaving.", "travel");
  memory.addArchival("Good pasta dough needs enough resting time.", "cooking");

  expect(memory.searchArchival("pasta", 5).map((result) => result.content)).toEqual([
    "Good pasta dough needs enough resting time.",
  ]);

  memory.close();
});

test("string fallback searches tags as well as content", async () => {
  const memory = await makeMemory(null);

  memory.addArchival("Some unrelated text here.", "cooking");
  memory.addArchival("Also unrelated content.", "travel");

  const results = memory.searchArchival("travel", 5);
  expect(results).toHaveLength(1);
  expect(results[0].content).toBe("Also unrelated content.");

  memory.close();
});

test("searchArchival caches embeddings and does not re-embed on second search", async () => {
  let embedCallCount = 0;
  const countingProvider: EmbeddingProvider = {
    name: "counting",
    model: "v1",
    embed(text: string): number[] | null {
      embedCallCount++;
      return fakeEmbeddingProvider.embed(text);
    },
  };

  const memory = await makeMemory(countingProvider);

  memory.addArchival("Road trip notes: charge the car before leaving.", "travel");
  memory.addArchival("Good pasta dough needs enough resting time.", "cooking");

  // addArchival already embeds: 2 calls
  expect(embedCallCount).toBe(2);

  // First search embeds the query (1 call) + hits cache for both memories (0 re-embeds)
  embedCallCount = 0;
  memory.searchArchival("automobile journey", 2);
  expect(embedCallCount).toBe(1);

  // Second search for same query: same cache hit behavior
  embedCallCount = 0;
  memory.searchArchival("automobile journey", 2);
  expect(embedCallCount).toBe(1);

  memory.close();
});
