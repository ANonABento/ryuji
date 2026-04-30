import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactionRoleDB } from "./db.ts";
import { emojiKeyFromInput } from "./emoji.ts";

test("emojiKeyFromInput normalizes custom emoji markup to IDs", () => {
  expect(emojiKeyFromInput("✅")).toBe("✅");
  expect(emojiKeyFromInput("<:party:123456789012345678>")).toBe(
    "123456789012345678"
  );
  expect(emojiKeyFromInput("<a:dance:123456789012345678>")).toBe(
    "123456789012345678"
  );
});

test("ReactionRoleDB persists and updates mappings", () => {
  const dir = join(tmpdir(), `choomfie-reaction-roles-${Date.now()}`);
  const dbPath = join(dir, "reaction-roles.db");
  mkdirSync(dir, { recursive: true });
  const db = new ReactionRoleDB(dbPath);

  db.upsert({
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
    emojiKey: "✅",
    roleId: "role-1",
  });

  expect(db.get("guild-1", "message-1", "✅")?.roleId).toBe("role-1");

  db.upsert({
    guildId: "guild-1",
    channelId: "channel-1",
    messageId: "message-1",
    emojiKey: "✅",
    roleId: "role-2",
  });

  expect(db.get("guild-1", "message-1", "✅")?.roleId).toBe("role-2");
  db.close();
  rmSync(dir, { force: true, recursive: true });
});
