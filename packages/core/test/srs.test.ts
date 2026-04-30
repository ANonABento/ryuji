import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands, modalHandlers, type PluginContext } from "@choomfie/shared";
import { SRSManager } from "../../../plugins/tutor/core/srs.ts";
import { setSRS } from "../../../plugins/tutor/core/srs-instance.ts";
import { setModule } from "../../../plugins/tutor/core/session.ts";
import { srsTools } from "../../../plugins/tutor/tools/srs-tools.ts";
import "../../../plugins/tutor/srs-interactions.ts";

const tempDirs: string[] = [];
const emptyContext = {} as PluginContext;

function resultText(result: Awaited<ReturnType<(typeof srsTools)[number]["handler"]>>): string {
  return result.content[0]?.text ?? "";
}

afterEach(async () => {
  setSRS(null);
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

test("SRS manager can create, list, and delete empty decks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const srs = new SRSManager(join(dir, "srs.db"));
  expect(srs.createDeck("user-1", "manual")).toBe(true);
  expect(srs.createDeck("user-1", "manual")).toBe(false);

  expect(srs.listDecks("user-1")).toMatchObject([
    { name: "manual", total: 0, due: 0, learned: 0 },
  ]);

  const deleted = srs.deleteDeck("user-1", "manual");
  expect(deleted).toEqual({ existed: true, deletedCards: 0 });
  expect(srs.listDecks("user-1")).toEqual([]);

  srs.close();
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

test("srs_review defaults to active module lesson deck and shows card IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const userId = "chinese-srs-user";
  const srs = new SRSManager(join(dir, "srs.db"));
  setSRS(srs);
  setModule(userId, "chinese", "HSK1");
  const cardId = srs.addCard(userId, "你好", "hello", "ni3 hao3", "lesson-chinese");

  const tool = srsTools.find((t) => t.definition.name === "srs_review");
  expect(tool).toBeDefined();

  const result = await tool!.handler({ user_id: userId }, emptyContext);
  const text = resultText(result);

  expect(text).toContain("**1 cards due** (lesson-chinese)");
  expect(text).toContain(`Card #${cardId}: 你好 (ni3 hao3)`);
  expect(text).not.toContain("jlpt-n5");

  srs.close();
});

test("/add_card modal saves a manual card to the selected deck", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);

  const userId = "manual-card-user";
  const srs = new SRSManager(join(dir, "srs.db"));
  setSRS(srs);

  const addCard = commands.get("add_card");
  expect(addCard).toBeDefined();

  let modalCustomId = "";
  await addCard!.handler(
    {
      user: { id: userId },
      options: {
        getString: (name: string) => (name === "deck" ? "manual" : null),
      },
      showModal: async (modal: { toJSON: () => { custom_id: string } }) => {
        modalCustomId = modal.toJSON().custom_id;
      },
    } as any,
    emptyContext
  );

  const modalHandler = modalHandlers.get("srs-add-card");
  expect(modalHandler).toBeDefined();
  expect(modalCustomId).toStartWith("srs-add-card:");

  let replyContent = "";
  await modalHandler!(
    {
      user: { id: userId },
      fields: {
        getTextInputValue: (name: string) => {
          const values: Record<string, string> = {
            front: "見る",
            back: "to see",
            reading: "みる",
            tags: "verb",
          };
          return values[name] ?? "";
        },
      },
      reply: async (payload: { content: string }) => {
        replyContent = payload.content;
      },
    } as any,
    modalCustomId.split(":"),
    emptyContext
  );

  expect(replyContent).toContain("Added card");
  expect(srs.hasDeck(userId, "manual")).toBe(true);
  expect(srs.getDeckStats(userId, "manual")).toMatchObject({ total: 1, due: 1, learned: 0 });

  srs.close();
});
