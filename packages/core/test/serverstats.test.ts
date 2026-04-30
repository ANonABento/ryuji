import { Collection } from "discord.js";
import { expect, test } from "bun:test";
import { commands } from "@choomfie/shared";
import { MessageFlags } from "discord.js";

await import("../lib/commands.ts");

function makeMessage(id: string, createdAt: Date) {
  return { id, createdAt };
}

function startOfCurrentDay(reference: Date): Date {
  const current = new Date(reference);
  current.setHours(0, 0, 0, 0);
  return current;
}

function safeRecentMessage(reference: Date, minutesAgo: number): Date {
  const min = startOfCurrentDay(reference).getTime() + 60_000;
  const target = reference.getTime() - minutesAgo * 60 * 1000;
  return new Date(Math.max(target, min));
}

function makeMessageBatch(prefix: string, reference: Date, count: number) {
  const rows: Array<[string, { id: string; createdAt: Date }]> = [];
  for (let i = 0; i < count; i += 1) {
    rows.push([`${prefix}-${i}`, { id: `${prefix}-${i}`, createdAt: new Date(reference.getTime() - i * 60 * 1000) }]);
  }
  return new Collection<string, { id: string; createdAt: Date }>(rows);
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
  const referenceNow = new Date();
  const recentMessages = new Collection<string, { id: string; createdAt: Date }>([
    ["m1", makeMessage("m1", safeRecentMessage(referenceNow, 60))],
    ["m2", makeMessage("m2", safeRecentMessage(referenceNow, 5))],
  ]);
  const oldMessage = new Collection<string, { id: string; createdAt: Date }>([
    ["m3", makeMessage("m3", new Date(startOfCurrentDay(referenceNow).getTime() - 60 * 1000))],
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

test("/serverstats handler returns no-message message when history is empty", async () => {
  const def = commands.get("serverstats")!;
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
          fetch: async () => new Collection<string, { id: string; createdAt: Date }>(),
        },
      },
    ],
    ["c2", { id: "c2", name: "voice", isTextBased: () => false, messages: {} as never }],
  ]);

  let editPayload: { embeds?: Array<{ data: { fields?: Array<{ name: string; value: string }> } }> } | undefined;

  const interaction: any = {
    guild: {
      id: "guild-id",
      name: "Guild",
      fetch: async () => ({
        ...interaction.guild,
        approximateMemberCount: 2,
        memberCount: 2,
        approximatePresenceCount: 1,
      }),
      channels: {
        fetch: async () => channels,
      },
    },
    deferReply: async () => {},
    editReply: async (payload: typeof editPayload) => {
      editPayload = payload;
    },
  };

  await def.handler(interaction, {} as any);

  const embedData = editPayload?.embeds?.[0]?.data;
  const current = embedData?.fields?.find((field) => field.name === "Current Stats");
  expect(current?.value).toContain("**Messages today:** 0");
  const top = embedData?.fields?.find((field) => field.name === "Top 5 Active Channels");
  expect(top?.value).toContain("No messages were sent today.");
});

test("/serverstats handler keeps only top 5 channels by message count", async () => {
  const def = commands.get("serverstats")!;
  const referenceNow = new Date();

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
        name: "one",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c1", referenceNow, 12),
      },
    ],
    [
      "c2",
      {
        id: "c2",
        name: "two",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c2", referenceNow, 11),
      },
    ],
    [
      "c3",
      {
        id: "c3",
        name: "three",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c3", referenceNow, 10),
      },
    ],
    [
      "c4",
      {
        id: "c4",
        name: "four",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c4", referenceNow, 9),
      },
    ],
    [
      "c5",
      {
        id: "c5",
        name: "five",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c5", referenceNow, 8),
      },
    ],
    [
      "c6",
      {
        id: "c6",
        name: "six",
        isTextBased: () => true,
        messages: async () => makeMessageBatch("c6", referenceNow, 7),
      },
    ],
  ]);

  let editPayload: { embeds?: Array<{ data: { fields?: Array<{ name: string; value: string }> } }> } | undefined;

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
    deferReply: async () => {},
    editReply: async (payload: typeof editPayload) => {
      editPayload = payload;
    },
  };

  await def.handler(interaction, {} as any);

  const top = editPayload?.embeds?.[0]?.data?.fields?.find((field) => field.name === "Top 5 Active Channels")?.value ?? "";
  expect(top).toContain("<#c1>");
  expect(top).toContain("<#c2>");
  expect(top).toContain("<#c3>");
  expect(top).toContain("<#c4>");
  expect(top).toContain("<#c5>");
  expect(top).not.toContain("<#c6>");
});

test("/serverstats handler replies ephemerally when used in DMs", async () => {
  const def = commands.get("serverstats")!;

  let replied = false;
  let replyFlags: number | undefined;
  let replyContent: string | undefined;
  let deferred = false;

  const interaction: any = {
    deferReply: async () => {
      deferred = true;
    },
    reply: async ({ content, flags }: { content: string; flags?: number }) => {
      replied = true;
      replyContent = content;
      replyFlags = flags;
    },
  };

  await def.handler(interaction, {} as any);

  expect(replied).toBe(true);
  expect(deferred).toBe(false);
  expect(replyFlags).toBe(MessageFlags.Ephemeral);
  expect(replyContent).toBe("Server stats can only be used in a guild.");
});
