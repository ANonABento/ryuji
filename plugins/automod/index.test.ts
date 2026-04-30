import { commands } from "@choomfie/shared";
import { expect, test } from "bun:test";
import automodPlugin from ".";

interface FakeConfig {
  getAutomodConfig: () => {
    maxMessagesPerMinute: number;
    bannedWords: string[];
    action: "warn" | "timeout" | "kick";
  };
  setAutomodConfig: (next: {
    maxMessagesPerMinute?: number;
    bannedWords?: string[];
    action?: "warn" | "timeout" | "kick";
  }) => void;
}

function fakePluginContext(overrides: {
  config: FakeConfig;
  ownerUserId?: string;
}) {
  return {
    ownerUserId: overrides.ownerUserId ?? "owner-user",
    config: overrides.config,
  };
}

test("automod command is owner-only", async () => {
  const replies: string[] = [];
  const cfg = {
    automod: {
      maxMessagesPerMinute: 20,
      bannedWords: ["bad"],
      action: "warn" as const,
    },
    setAutomodConfig(next: any) {
      this.automod = { ...this.automod, ...next };
    },
    getAutomodConfig() {
      return { ...this.automod, bannedWords: [...this.automod.bannedWords] };
    },
  };

  await automodPlugin.init(fakePluginContext({ config: cfg }));

  const handler = commands.get("automod_config")?.handler;
  expect(handler).toBeDefined();

  const denied = {
    user: { id: "other-user" },
    options: {
      getInteger: () => null,
      getString: () => null,
    },
    reply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
  };

  await handler!(denied as any, fakePluginContext({ config: cfg, ownerUserId: "owner-user" }));
  expect(replies.at(-1)).toContain("owner-only");
});

test("rate limit and cooldown apply warn action", async () => {
  const member = {
    timeout: async () => {},
    kick: async () => {},
  };

  let fetchCalls = 0;
  const replies: string[] = [];
  const config: FakeConfig = {
    automod: {
      maxMessagesPerMinute: 1,
      bannedWords: [],
      action: "warn" as const,
    },
    getAutomodConfig() {
      return { ...this.automod, bannedWords: [...this.automod.bannedWords] };
    },
    setAutomodConfig(next: any) {
      this.automod = { ...this.automod, ...next };
    },
  };

  const ctx = {
    ownerUserId: "owner-user",
    config,
  };

  const message = {
    guild: {
      members: {
        fetch: async () => {
          fetchCalls++;
          return member;
        },
      },
    },
    member: null,
    author: { id: "spammer" },
    content: "hello",
    reply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
  };

  await automodPlugin.onMessage!(message as any, ctx as any);
  await automodPlugin.onMessage!(message as any, ctx as any);
  await automodPlugin.onMessage!(message as any, ctx as any);

  expect(fetchCalls).toBe(1);
  expect(replies).toHaveLength(1);
  expect(replies[0]).toContain("⚠️ Moderation triggered");
});

test("banned words trigger the configured timeout action", async () => {
  const timeoutCalls: string[] = [];
  const member = {
    timeout: async () => {
      timeoutCalls.push("timeout");
    },
    kick: async () => {},
  };
  const replies: string[] = [];
  const config: FakeConfig = {
    automod: {
      maxMessagesPerMinute: 100,
      bannedWords: ["forbidden"],
      action: "timeout" as const,
    },
    getAutomodConfig() {
      return { ...this.automod, bannedWords: [...this.automod.bannedWords] };
    },
    setAutomodConfig(next: any) {
      this.automod = { ...this.automod, ...next };
    },
  };

  const ctx = {
    ownerUserId: "owner-user",
    config,
  };

  const message = {
    guild: {
      members: {
        fetch: async () => {
          timeoutCalls.push("fetch");
          return member;
        },
      },
    },
    member: null,
    author: { id: "spammer-timeout" },
    content: "This contains FORBIDDEN text",
    reply: async ({ content }: { content: string }) => {
      replies.push(content);
    },
  };

  await automodPlugin.onMessage!(message as any, ctx as any);

  expect(timeoutCalls).toHaveLength(1);
  expect(replies.join("")).toContain("User timed out for 1 minute");
});
