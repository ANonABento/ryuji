import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands, modalHandlers, type PluginContext } from "@choomfie/shared";
import type {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import { SRSManager } from "../../../plugins/tutor/core/srs.ts";
import { setSRS } from "../../../plugins/tutor/core/srs-instance.ts";
import { setModule } from "../../../plugins/tutor/core/session.ts";
import { srsTools } from "../../../plugins/tutor/tools/srs-tools.ts";
import { buildAddCardModal } from "../../../plugins/tutor/srs-interactions.ts";

const tempDirs: string[] = [];
const emptyContext = {} as PluginContext;

interface ReplyPayload {
  content?: string;
  embeds?: EmbedBuilder[];
}

interface CommandInteractionStub {
  user: { id: string };
  options: {
    getString: (name: string, required?: boolean) => string | null;
    getSubcommand?: () => string;
  };
  reply?: (payload: ReplyPayload) => Promise<void>;
  showModal?: (modal: { toJSON: () => { custom_id: string } }) => Promise<void>;
}

interface ModalInteractionStub {
  user: { id: string };
  fields: {
    getTextInputValue: (name: string) => string;
  };
  reply: (payload: ReplyPayload) => Promise<void>;
}

function resultText(result: Awaited<ReturnType<(typeof srsTools)[number]["handler"]>>): string {
  return result.content[0]?.text ?? "";
}

async function createSRS(): Promise<SRSManager> {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-srs-"));
  tempDirs.push(dir);
  return new SRSManager(join(dir, "srs.db"));
}

function commandInteraction(stub: CommandInteractionStub): ChatInputCommandInteraction {
  return stub as unknown as ChatInputCommandInteraction;
}

function modalInteraction(stub: ModalInteractionStub): ModalSubmitInteraction {
  return stub as unknown as ModalSubmitInteraction;
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
  const srs = await createSRS();
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
  const srs = await createSRS();
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
  const srs = await createSRS();
  const cardId = srs.addCard("owner-user", "見る", "to see", "みる", "deck-1");

  expect(() => srs.reviewCard("other-user", cardId, "good")).toThrow(
    /does not belong/
  );

  srs.close();
});

test("srs_review defaults to active module lesson deck and shows card IDs", async () => {
  const userId = "chinese-srs-user";
  const srs = await createSRS();
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
  const userId = "manual-card-user";
  const srs = await createSRS();
  setSRS(srs);

  const addCard = commands.get("add_card");
  expect(addCard).toBeDefined();

  let modalCustomId = "";
  await addCard!.handler(
    commandInteraction({
      user: { id: userId },
      options: {
        getString: (name: string) => (name === "deck" ? "manual" : null),
      },
      showModal: async (modal: { toJSON: () => { custom_id: string } }) => {
        modalCustomId = modal.toJSON().custom_id;
      },
    }),
    emptyContext
  );

  const modalHandler = modalHandlers.get("srs-add-card");
  expect(modalHandler).toBeDefined();
  expect(modalCustomId).toStartWith("srs-add-card:");

  let replyContent = "";
  await modalHandler!(
    modalInteraction({
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
      reply: async (payload: ReplyPayload) => {
        replyContent = payload.content ?? "";
      },
    }),
    modalCustomId.split(":"),
    emptyContext
  );

  expect(replyContent).toContain("Added card");
  expect(srs.hasDeck(userId, "manual")).toBe(true);
  expect(srs.getDeckStats(userId, "manual")).toMatchObject({
    total: 1,
    due: 1,
    learned: 0,
  });

  srs.close();
});

test("/decks command can create, list stats, and delete a deck", async () => {
  const userId = "deck-command-user";
  const srs = await createSRS();
  setSRS(srs);

  const decks = commands.get("decks");
  expect(decks).toBeDefined();

  const replies: ReplyPayload[] = [];
  const runDeckCommand = async (subcommand: string, name?: string) => {
    await decks!.handler(
      commandInteraction({
        user: { id: userId },
        options: {
          getSubcommand: () => subcommand,
          getString: () => name ?? null,
        },
        reply: async (payload: ReplyPayload) => {
          replies.push(payload);
        },
      }),
      emptyContext
    );
  };

  await runDeckCommand("create", "manual");
  expect(replies.at(-1).content).toContain("Created SRS deck **manual**");
  expect(srs.hasDeck(userId, "manual")).toBe(true);

  srs.addCard(userId, "見る", "to see", "みる", "manual");

  await runDeckCommand("list");
  expect(replies.at(-1)?.embeds?.[0]?.toJSON().description).toContain(
    "**manual**"
  );

  await runDeckCommand("stats", "manual");
  expect(replies.at(-1)?.embeds?.[0]?.toJSON().fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Total", value: "1" }),
      expect.objectContaining({ name: "Due", value: "1" }),
    ])
  );

  await runDeckCommand("delete", "manual");
  expect(replies.at(-1)?.content).toContain(
    "Deleted SRS deck **manual** and 1 cards"
  );
  expect(srs.hasDeck(userId, "manual")).toBe(false);

  srs.close();
});

test("/add_card rejects unavailable SRS and expired modal submissions", async () => {
  const addCard = commands.get("add_card");
  expect(addCard).toBeDefined();

  let replyContent = "";
  await addCard!.handler(
    commandInteraction({
      user: { id: "no-srs-user" },
      options: {
        getString: () => "manual",
      },
      reply: async (payload: ReplyPayload) => {
        replyContent = payload.content ?? "";
      },
    }),
    emptyContext
  );
  expect(replyContent).toBe("SRS is not initialized.");

  const srs = await createSRS();
  setSRS(srs);

  const originalNow = Date.now;
  Date.now = () => originalNow();
  const modalCustomId = buildAddCardModal(
    "expired-user",
    "manual"
  ).toJSON().custom_id;
  Date.now = () => originalNow() + 16 * 60 * 1000;

  const modalHandler = modalHandlers.get("srs-add-card");
  expect(modalHandler).toBeDefined();

  try {
    await modalHandler!(
      modalInteraction({
        user: { id: "expired-user" },
        fields: {
          getTextInputValue: () => "value",
        },
        reply: async (payload: ReplyPayload) => {
          replyContent = payload.content ?? "";
        },
      }),
      modalCustomId.split(":"),
      emptyContext
    );
  } finally {
    Date.now = originalNow;
  }

  expect(replyContent).toContain("expired");
  expect(srs.hasDeck("expired-user", "manual")).toBe(false);

  srs.close();
});
