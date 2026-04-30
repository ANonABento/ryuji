import { expect, test } from "bun:test";
import { commands } from "@choomfie/shared";
import type { AppContext } from "../lib/types.ts";
import { handleGuildMemberAdd, renderWelcomeTemplate } from "../lib/handlers/welcome.ts";

type Spy = ((...args: any[]) => any) & { calls: any[][] };
function spy(): Spy {
  const fn: any = (...args: any[]) => {
    fn.calls.push(args);
  };
  fn.calls = [];
  return fn;
}

function spyWithImpl<T extends (...args: any[]) => any>(impl: T): Spy {
  const fn: any = (...args: any[]) => {
    fn.calls.push(args);
    return impl(...args);
  };
  fn.calls = [];
  return fn;
}

test("handleGuildMemberAdd sends welcome content to configured channel", async () => {
  const send = spy();
  const fetch = spyWithImpl(async () => channel);
  const channel = {
    isTextBased: () => true,
    send,
  } as any;

  const ctx = {
    config: {
      getWelcomeConfig: () => ({
        channelId: "channel-id",
        template: "Welcome {username}!",
      }),
    },
    messageStats: { sent: 0 },
  } as unknown as AppContext;

  await handleGuildMemberAdd(
    {
      guild: {
        channels: { fetch },
        name: "Choomfie",
        memberCount: 5,
      },
      id: "user-1",
      displayName: "Bento",
      user: { username: "bentomac" },
      guildId: "guild-1",
    } as any,
    ctx
  );

  expect(fetch.calls).toHaveLength(1);
  expect(fetch.calls[0][0]).toBe("channel-id");
  expect(send.calls).toHaveLength(1);
  expect(send.calls[0][0]).toEqual({
    content: "Welcome bentomac!",
    allowedMentions: { users: ["user-1"], roles: [], parse: [] },
  });
  expect(ctx.messageStats.sent).toBe(1);
});

test("welcome_config updates config and requires owner", async () => {
  await import("../lib/handlers/welcome.ts");
  const cmd = commands.get("welcome_config");
  expect(cmd).toBeTruthy();

  const cfg = { channelId: "old-channel", template: "Welcome {user}!" };
  const setWelcomeConfig = spyWithImpl(() => {});
  const ctx = {
    ownerUserId: "owner",
    config: {
      getWelcomeConfig: () => ({ ...cfg }),
      setWelcomeConfig: (next: { channelId: string; template: string }) => {
        Object.assign(cfg, next);
        setWelcomeConfig(next);
      },
    },
  } as unknown as AppContext;

  const ownerInteraction = {
    user: { id: "owner" },
    guildId: "guild-1",
    guild: { name: "Guild", memberCount: 12 },
    member: { displayName: "Owner" },
    options: {
      getChannel: () => ({ id: "channel-new" }),
      getString: () => "Welcome {displayName} to {server}!",
      getBoolean: () => true,
    },
    reply: spy(),
    deferReply: async () => {},
  } as any;

  await cmd!.handler(ownerInteraction, ctx);
  expect(cfg.channelId).toBe("channel-new");
  expect(cfg.template).toBe("Welcome {displayName} to {server}!");
  expect(setWelcomeConfig.calls).toHaveLength(1);
  expect(ownerInteraction.reply.calls).toHaveLength(1);
  expect(ownerInteraction.reply.calls[0][0].content).toContain("Welcome messages are **enabled");

  const intruderInteraction = {
    user: { id: "intruder" },
    guildId: "guild-1",
    options: { getChannel: () => null, getString: () => null, getBoolean: () => null },
    reply: spy(),
  } as any;
  await cmd!.handler(intruderInteraction, ctx);
  expect(intruderInteraction.reply.calls).toHaveLength(1);
  expect(intruderInteraction.reply.calls[0][0].content).toBe("This command is owner-only~");
});

test("welcome_config blocks enabling without channel configured", async () => {
  await import("../lib/handlers/welcome.ts");
  const cmd = commands.get("welcome_config");
  expect(cmd).toBeTruthy();

  const cfg = { channelId: null as string | null, template: "Welcome {user}!" };
  const setWelcomeConfig = spyWithImpl(() => {});
  const ctx = {
    ownerUserId: "owner",
    config: {
      getWelcomeConfig: () => ({ ...cfg }),
      setWelcomeConfig: (next: any) => {
        Object.assign(cfg, next);
        setWelcomeConfig(next);
      },
    },
  } as unknown as AppContext;

  const ownerInteraction = {
    user: { id: "owner" },
    guildId: "guild-1",
    guild: { name: "Guild", memberCount: 3 },
    member: { displayName: "Owner" },
    options: {
      getChannel: () => null,
      getString: () => null,
      getBoolean: () => true,
    },
    reply: spy(),
    deferReply: async () => {},
  } as any;

  await cmd!.handler(ownerInteraction, ctx);

  expect(cfg.channelId).toBeNull();
  expect(cfg.template).toBe("Welcome {user}!");
  expect(setWelcomeConfig.calls).toHaveLength(0);
  expect(ownerInteraction.reply.calls).toHaveLength(1);
  expect(ownerInteraction.reply.calls[0][0].content).toBe("Choose a channel before enabling welcome messages.");
});

test("handleGuildMemberAdd ignores bot users", async () => {
  const send = spy();
  const fetch = spyWithImpl(async () => channel);
  const channel = {
    isTextBased: () => true,
    send,
  } as any;

  const ctx = {
    config: {
      getWelcomeConfig: () => ({
        channelId: "channel-id",
        template: "Welcome {username}!",
      }),
    },
    messageStats: { sent: 0 },
  } as unknown as AppContext;

  await handleGuildMemberAdd(
    {
      guild: {
        channels: { fetch },
        name: "Choomfie",
        memberCount: 5,
      },
      id: "user-1",
      displayName: "BentoBot",
      user: { username: "bot-user", bot: true },
      guildId: "guild-1",
    } as any,
    ctx
  );

  expect(fetch.calls).toHaveLength(0);
  expect(send.calls).toHaveLength(0);
  expect(ctx.messageStats.sent).toBe(0);
});

test("renderWelcomeTemplate keeps placeholders intact when values are missing", () => {
  const rendered = renderWelcomeTemplate(
    "Hi {user} {username} {displayName} {server} #{memberCount} {missing}",
    {
      id: "123",
      displayName: "Bento",
      user: { username: "bentomac" },
      guild: { name: "Choomfie", memberCount: 1 },
    }
  );
  expect(rendered).toBe("Hi <@123> bentomac Bento Choomfie #1 {missing}");
});
