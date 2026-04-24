import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SRSManager } from "../../../plugins/tutor/core/srs.ts";
import { formatAnkiTSV } from "../../../plugins/tutor/core/anki-export.ts";

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

test("SRS stats do not count untouched cards as learned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  srs.importDeck("user-1", "deck-1", [
    { front: "食べる", back: "to eat", reading: "たべる" },
    { front: "飲む", back: "to drink", reading: "のむ" },
  ]);

  const stats = srs.getDeckStats("user-1", "deck-1");
  srs.close();

  expect(stats.total).toBe(2);
  expect(stats.learned).toBe(0);
});

test("SRS reviewCard rejects cards owned by another user", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  const cardId = srs.addCard("owner-user", "見る", "to see", "みる", "deck-1");

  expect(() => srs.reviewCard("other-user", cardId, "good")).toThrow(
    /does not belong/
  );

  srs.close();
});

test("exportCards returns only cards in the requested deck", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  srs.importDeck("user-1", "deck-a", [
    { front: "犬", back: "dog", reading: "いぬ" },
    { front: "猫", back: "cat", reading: "ねこ" },
  ]);
  srs.importDeck("user-1", "deck-b", [
    { front: "水", back: "water", reading: "みず" },
  ]);

  const result = srs.exportCards("user-1", { deck: "deck-a" });
  srs.close();

  expect(result).toHaveLength(2);
  expect(result.every((c) => c.deck === "deck-a")).toBe(true);
});

test("exportCards filters by tag without substring false-positives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  srs.importDeck("user-1", "deck-1", [
    { front: "犬", back: "dog", reading: "いぬ", tags: "animal,noun" },
    { front: "猫たち", back: "cats", reading: "ねこたち", tags: "animals" },
  ]);

  const result = srs.exportCards("user-1", { tag: "animal" });
  srs.close();

  expect(result).toHaveLength(1);
  expect(result[0].front).toBe("犬");
});

test("exportCards combines deck + tag filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  srs.importDeck("user-1", "deck-a", [
    { front: "犬", back: "dog", reading: "いぬ", tags: "animal" },
    { front: "本", back: "book", reading: "ほん", tags: "object" },
  ]);
  srs.importDeck("user-1", "deck-b", [
    { front: "鳥", back: "bird", reading: "とり", tags: "animal" },
  ]);

  const result = srs.exportCards("user-1", { deck: "deck-a", tag: "animal" });
  srs.close();

  expect(result).toHaveLength(1);
  expect(result[0].front).toBe("犬");
  expect(result[0].deck).toBe("deck-a");
});

test("exportCards returns all user cards when no filter is given", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  srs.importDeck("user-1", "deck-a", [
    { front: "犬", back: "dog", reading: "いぬ" },
  ]);
  srs.importDeck("user-1", "deck-b", [
    { front: "水", back: "water", reading: "みず" },
  ]);
  srs.importDeck("user-2", "deck-a", [
    { front: "火", back: "fire", reading: "ひ" },
  ]);

  const result = srs.exportCards("user-1");
  srs.close();

  expect(result).toHaveLength(2);
  expect(result.every((c) => c.userId === "user-1")).toBe(true);
});

test("formatAnkiTSV emits required header directives", () => {
  const cards = [
    {
      id: 1,
      userId: "u",
      front: "犬",
      back: "dog",
      reading: "いぬ",
      deck: "jlpt-n5",
      tags: "",
      cardState: "{}",
      nextReview: "",
      createdAt: "",
    },
  ];

  const withDeck = formatAnkiTSV(cards, "jlpt-n5");
  expect(withDeck).toContain("#separator:tab");
  expect(withDeck).toContain("#html:true");
  expect(withDeck).toContain("#tags column:4");
  expect(withDeck).toContain("#deck:jlpt-n5");

  const noDeck = formatAnkiTSV(cards);
  expect(noDeck).not.toContain("#deck:");
});

test("formatAnkiTSV escapes tabs and newlines in fields", () => {
  const cards = [
    {
      id: 1,
      userId: "u",
      front: "line1\nline2",
      back: "a\tb",
      reading: "",
      deck: "d",
      tags: "",
      cardState: "{}",
      nextReview: "",
      createdAt: "",
    },
  ];

  const output = formatAnkiTSV(cards, "d");
  const rows = output.split("\n").filter((l) => l && !l.startsWith("#"));
  expect(rows).toHaveLength(1);

  const cols = rows[0].split("\t");
  expect(cols).toHaveLength(4);
  expect(cols[0]).toBe("line1<br>line2");
  expect(cols[2]).toBe("a b");
});

test("formatAnkiTSV converts comma tags to space tags", () => {
  const cards = [
    {
      id: 1,
      userId: "u",
      front: "f",
      back: "b",
      reading: "",
      deck: "d",
      tags: "jlpt-n5,verb",
      cardState: "{}",
      nextReview: "",
      createdAt: "",
    },
  ];

  const output = formatAnkiTSV(cards, "d");
  const row = output.split("\n").filter((l) => l && !l.startsWith("#"))[0];
  const cols = row.split("\t");
  expect(cols[3]).toBe("jlpt-n5 verb");
});

test("formatAnkiTSV leaves tag column empty for untagged cards", () => {
  const cards = [
    {
      id: 1,
      userId: "u",
      front: "f",
      back: "b",
      reading: "",
      deck: "d",
      tags: "",
      cardState: "{}",
      nextReview: "",
      createdAt: "",
    },
  ];

  const output = formatAnkiTSV(cards, "d");
  const row = output.split("\n").filter((l) => l && !l.startsWith("#"))[0];
  const cols = row.split("\t");
  expect(cols).toHaveLength(4);
  expect(cols[3]).toBe("");
});

test("formatAnkiTSV handles zero cards as header-only", () => {
  const output = formatAnkiTSV([], "empty");
  const lines = output.split("\n").filter(Boolean);
  expect(lines.every((l) => l.startsWith("#"))).toBe(true);
});
