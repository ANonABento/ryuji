import { Collection } from "discord.js";
import { expect, test } from "bun:test";
import { commands } from "@choomfie/shared";
import { MessageFlags } from "discord.js";

await import("../lib/commands.ts");

const now = new Date();

function makeMessage(id: string, createdAt: Date) {
  return { id, createdAt };
}

test("/serverstats command is registered with guild-only visibility", () => {
  const def = commands.get("serverstats");
  expect(def).toBeDefined();
  expect(def!.data.name).toBe("serverstats");
  expect(def!.data.dm_permission).toBe(false);
  expect(def!.data.description).toBe("Show guild statistics and today's activity");
});

test("/serverstats handler builds an embed payload with expected sections", async () => {
  const def = commands.get("serverstats")!;
  const recentMessages = new Collection<string, { id: string; createdAt: Date }>([
    ["m1", makeMessage("m1", new Date(now.getTime() - 1000 * 60 * 60))],
    ["m2", makeMessage("m2", new Date(now.getTime() - 1000 * 60 * 5))],
  ]);
  const oldMessage = new Collection<string, { id: string; createdAt: Date }>([
    ["m3", makeMessage("m3", new Date(now.getTime() - 1000 * 60 * 60 * 28))],
  ]);
  const channels = new Collection<string, {
    id: string;
    name: string | null;
    isTextBased: () => boolean;
    messages: { fetch: ({ limit, before }: { limit: number; before?: string }) => Promise<Collection<string, { id: string; createdAt: Date }>>; };
  }>([
    [
      "c1",
      {
        id: "c1",
        name: "general",
        isTextBased: () => true,
        messages: {
          fetch: async ({ limit: _limit, before }: { limit: number; before?: string }) =>
            before ? new Collection<string, { id: string; createdAt: Date }>() : recentMessages,
        },
      },
    ],
    [
      "c2",
      {
        id: "c2",
        name: null,
        isTextBased: () => true,
        messages: {
          fetch: async ({ limit: _limit, before }: { limit: number; before?: string }) =>
            before ? new Collection<string, { id: string; createdAt: Date }>() : oldMessage,
        },
      },
    ],
    ["c3", { id: "c3", name: "voice", isTextBased: () => false, messages: {} as never }],
  ]);

  let deferred = false;
  let deferredFlags: number | undefined;
  let editPayload: { embeds?: Array<{ data: { title?: string; fields?: Array<{ name: string; value: string }> } }> } | undefined;

  const interaction: any = {
    guild: {
      id: "guild-id",
      name: "Guild",
      fetch: async () => ({
        ...interaction.guild,
        approximateMemberCount: 128,
        memberCount: 0,
        approximatePresenceCount: 64,
      }),
      channels: {
        fetch: async () => channels,
      },
    },
    deferReply: async (opts: { flags?: number }) => {
      deferred = true;
      deferredFlags = opts?.flags;
    },
    editReply: async (payload: typeof editPayload) => {
      editPayload = payload;
    },
  };

  await def.handler(interaction, {} as any);

  expect(deferred).toBe(true);
  expect(deferredFlags).toBe(MessageFlags.Ephemeral);
  expect(editPayload).toBeDefined();
  expect(editPayload!.embeds).toBeDefined();

  const embedData = editPayload!.embeds![0].data;
  expect(embedData.title).toBe("Server Stats — Guild");
  expect(embedData.fields).toHaveLength(2);

  const current = embedData.fields?.find((f) => f.name === "Current Stats");
  expect(current?.value).toContain("**Members:** 128");
  expect(current?.value).toContain("**Online:** 64");
  expect(current?.value).toContain("**Channels:** 3");
  expect(current?.value).toContain("**Messages today:** 2");

  const top = embedData.fields?.find((f) => f.name === "Top 5 Active Channels");
  expect(top?.value).toContain("<#c1>");
  expect(top?.value).toContain("2 messages");
});
