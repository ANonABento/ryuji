import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactionRoleDB } from "./db.ts";
import { emojiKeyFromInput, emojiKeyFromReaction } from "./emoji.ts";
import { applyReactionRole } from "./index.ts";

test("emojiKeyFromInput normalizes custom emoji markup to IDs", () => {
  expect(emojiKeyFromInput("✅")).toBe("✅");
  expect(emojiKeyFromInput("<:party:123456789012345678>")).toBe(
    "123456789012345678"
  );
  expect(emojiKeyFromInput("<a:dance:123456789012345678>")).toBe(
    "123456789012345678"
  );
});

test("emojiKeyFromReaction matches unicode and custom emoji keys", () => {
  expect(
    emojiKeyFromReaction({ emoji: { id: null, name: "✅" } } as any)
  ).toBe("✅");
  expect(
    emojiKeyFromReaction({
      emoji: { id: "123456789012345678", name: "party" },
    } as any)
  ).toBe("123456789012345678");
});

test("ReactionRoleDB persists and updates mappings", () => {
  const dir = mkdtempSync(join(tmpdir(), "choomfie-reaction-roles-"));
  const dbPath = join(dir, "reaction-roles.db");
  const db = new ReactionRoleDB(dbPath);

  db.upsert({
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
    emojiKey: "✅",
    roleId: "role-1",
  });

  expect(db.get("guild-1", "channel-1", "message-1", "✅")?.roleId).toBe(
    "role-1"
  );
  expect(db.get("guild-1", "channel-2", "message-1", "✅")).toBeNull();

  db.upsert({
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
    emojiKey: "✅",
    roleId: "role-2",
  });

  expect(db.get("guild-1", "channel-1", "message-1", "✅")?.roleId).toBe(
    "role-2"
  );
  db.close();
  rmSync(dir, { force: true, recursive: true });
});

test("applyReactionRole adds and removes the configured role", async () => {
  const actions: string[] = [];
  const store = {
    get(guildId: string, channelId: string, messageId: string, emojiKey: string) {
      expect([guildId, channelId, messageId, emojiKey]).toEqual([
        "guild-1",
        "channel-1",
        "message-1",
        "✅",
      ]);
      return {
        guildId,
        channelId,
        messageId,
        emojiKey,
        roleId: "role-1",
      };
    },
  };
  const guild = {
    id: "guild-1",
    members: {
      async fetch(userId: string) {
        expect(userId).toBe("user-1");
        return {
          roles: {
            async add(roleId: string, reason: string) {
              actions.push(`add:${roleId}:${reason}`);
            },
            async remove(roleId: string, reason: string) {
              actions.push(`remove:${roleId}:${reason}`);
            },
          },
        };
      },
    },
  };
  const reaction = {
    partial: false,
    emoji: { id: null, name: "✅" },
    message: { id: "message-1", guild },
  };
  const user = { partial: false, bot: false, id: "user-1" };

  await applyReactionRole(store as any, reaction as any, user as any, "add");
  await applyReactionRole(store as any, reaction as any, user as any, "remove");

  expect(actions).toEqual([
    "add:role-1:Reaction role added",
    "remove:role-1:Reaction role removed",
  ]);
});

test("applyReactionRole ignores bots and unmapped reactions", async () => {
  let lookups = 0;
  let memberFetches = 0;
  const store = {
    get(guildId: string, channelId: string, messageId: string, emojiKey: string) {
      expect([guildId, channelId, messageId, emojiKey]).toEqual([
        "guild-1",
        "channel-1",
        "message-1",
        "✅",
      ]);
      lookups++;
      return null;
    },
  };
  const reaction = {
    partial: false,
    emoji: { id: null, name: "✅" },
    message: {
      id: "message-1",
      channelId: "channel-1",
      guild: {
        id: "guild-1",
        members: {
          async fetch() {
            memberFetches++;
            throw new Error("member fetch should not run");
          },
        },
      },
    },
  };

  await applyReactionRole(
    store as any,
    reaction as any,
    { partial: false, bot: true, id: "bot-1" } as any,
    "add"
  );
  await applyReactionRole(
    store as any,
    reaction as any,
    { partial: false, bot: false, id: "user-1" } as any,
    "add"
  );

  expect(lookups).toBe(1);
  expect(memberFetches).toBe(0);
});
