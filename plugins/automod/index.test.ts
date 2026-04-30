import {
  commands,
  type AutomodAction,
  type AutomodConfig,
  type PluginConfig,
} from "@choomfie/shared";
import { expect, test } from "bun:test";
import automodPlugin from ".";

type FakeAutomodConfig = Pick<
  PluginConfig,
  "getAutomodConfig" | "setAutomodConfig"
>;

interface FakeMessage {
  guild: {
    members: {
      fetch: (userId: string) => Promise<FakeGuildMember | null>;
    };
  };
  member: FakeGuildMember | null;
  author: {
    id: string;
  };
  content: string;
  reply: (payload: { content: string }) => Promise<void>;
}

interface FakeGuildMember {
  timeout: () => Promise<void>;
  kick: () => Promise<void>;
}

interface FakeCommandInteraction {
  user: {
    id: string;
  };
  options: {
    getInteger: () => number | null;
    getString: () => string | null;
  };
  reply: (payload: { content: string }) => Promise<void>;
}

interface FakePluginContext {
  ownerUserId?: string;
  config: FakeAutomodConfig;
}

const OWNER_USER_ID = "owner-user";

function createFakeAutomodConfig(
  seed: Omit<AutomodConfig, "action"> & {
    action: AutomodAction;
  }
): FakeAutomodConfig {
  let state: AutomodConfig = {
    ...seed,
    bannedWords: [...seed.bannedWords],
  };

  return {
    getAutomodConfig() {
      return { ...state, bannedWords: [...state.bannedWords] };
    },
    setAutomodConfig(next) {
      state = { ...state, ...next };
    },
  };
}

function fakePluginContext(overrides: {
  config: FakeAutomodConfig;
  ownerUserId?: string;
}): FakePluginContext {
  return {
    ownerUserId: overrides.ownerUserId ?? OWNER_USER_ID,
    config: overrides.config,
  };
}

function makeCommandInteraction(overrides: {
  userId?: string;
  onReply: (content: string) => void;
}): FakeCommandInteraction {
  return {
    user: { id: overrides.userId ?? OWNER_USER_ID },
    options: {
      getInteger: () => null,
      getString: () => null,
    },
    reply: async ({ content }) => {
      overrides.onReply(content);
    },
  };
}

function makeMessage(
  member: FakeGuildMember | null,
  authorId: string,
  content: string,
  onFetch?: (userId: string) => void,
  fetchResult?: FakeGuildMember | null
): FakeMessage {
  return {
    guild: {
      members: {
        fetch: async (userId) => {
          onFetch?.(userId);
          return fetchResult ?? member;
        },
      },
    },
    member,
    author: { id: authorId },
    content,
    reply: async () => undefined,
  };
}

test("automod command is owner-only", async () => {
  const replies: string[] = [];
  const cfg = createFakeAutomodConfig({
    maxMessagesPerMinute: 20,
    bannedWords: ["bad"],
    action: "warn",
  });

  await automodPlugin.init(fakePluginContext({ config: cfg }));

  const handler = commands.get("automod_config")?.handler;
  expect(handler).toBeDefined();

  const denied = makeCommandInteraction({
    userId: "other-user",
    onReply: (content) => replies.push(content),
  });

  await handler!(denied, fakePluginContext({ config: cfg, ownerUserId: OWNER_USER_ID }));
  expect(replies.at(-1)).toContain("owner-only");
});

test("rate limit and cooldown apply warn action", async () => {
  let fetchCalls = 0;
  const replies: string[] = [];
  const member: FakeGuildMember = {
    timeout: async () => {},
    kick: async () => {},
  };
  const config = createFakeAutomodConfig({
    maxMessagesPerMinute: 1,
    bannedWords: [],
    action: "warn",
  });

  const ctx: FakePluginContext = {
    ownerUserId: OWNER_USER_ID,
    config,
  };
  const message = makeMessage(null, "spammer", "hello", () => {
    fetchCalls += 1;
  }, member);
  message.reply = async ({ content }) => {
    replies.push(content);
  };

  await automodPlugin.onMessage!(message, ctx);
  await automodPlugin.onMessage!(message, ctx);
  await automodPlugin.onMessage!(message, ctx);

  expect(fetchCalls).toBe(1);
  expect(replies).toHaveLength(1);
  expect(replies[0]).toContain("⚠️ Moderation triggered");
});

test("banned words trigger the configured timeout action", async () => {
  const timeoutCalls: string[] = [];
  const replies: string[] = [];
  const member: FakeGuildMember = {
    timeout: async () => {
      timeoutCalls.push("timeout");
    },
    kick: async () => {},
  };
  const config = createFakeAutomodConfig({
    maxMessagesPerMinute: 100,
    bannedWords: ["forbidden"],
    action: "timeout",
  });

  const ctx: FakePluginContext = {
    ownerUserId: OWNER_USER_ID,
    config,
  };

  const message = makeMessage(
    member,
    "spammer-timeout",
    "This contains FORBIDDEN text",
    () => {
      timeoutCalls.push("fetch");
    },
    member
  );
  message.reply = async ({ content }) => {
    replies.push(content);
  };

  await automodPlugin.onMessage!(message, ctx);

  expect(timeoutCalls).toHaveLength(2);
  expect(replies.join("")).toContain("User timed out for 1 minute");
});
