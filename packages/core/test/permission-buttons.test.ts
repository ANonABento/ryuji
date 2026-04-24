/**
 * Unit tests for permission button handler.
 *
 * Covers the builder shape, owner-only guard, allow/deny notification wiring,
 * and malformed-customId short-circuits. No real Discord client — just lightweight
 * fakes in the style of plugins.test.ts.
 */

import { test, expect } from "bun:test";
import { ButtonStyle, MessageFlags } from "discord.js";
import { buttonHandlers } from "@choomfie/shared";
import { buildPermissionButtons } from "../lib/handlers/permission-buttons.ts";
// Side-effect import: registers the "permission" handler.
import "../lib/handlers/permission-buttons.ts";

// --- Tiny spy helper ---

type Spy = ((...args: any[]) => any) & { calls: any[][] };
const spy = (): Spy => {
  const fn: any = (...args: any[]) => {
    fn.calls.push(args);
  };
  fn.calls = [];
  return fn;
};

const OWNER_ID = "owner-id";

function makeFakeInteraction(userId: string, content = "prompt body") {
  return {
    user: { id: userId },
    message: { content },
    reply: spy(),
    update: spy(),
  };
}

function makeFakeCtx() {
  const notification = spy();
  const ctx = {
    ownerUserId: OWNER_ID,
    mcp: { notification },
  };
  return { ctx, notification };
}

function getHandler() {
  const handler = buttonHandlers.get("permission");
  if (!handler) throw new Error("permission handler not registered");
  return handler;
}

// --- Builder tests ---

test("buildPermissionButtons returns two buttons with correct customIds and styles", () => {
  const row = buildPermissionButtons("abc123");
  expect(row.components.length).toBe(2);

  const approve = row.components[0].toJSON() as any;
  expect(approve.custom_id).toBe("permission:allow:abc123");
  expect(approve.label).toBe("Approve");
  expect(approve.style).toBe(ButtonStyle.Success);

  const deny = row.components[1].toJSON() as any;
  expect(deny.custom_id).toBe("permission:deny:abc123");
  expect(deny.label).toBe("Deny");
  expect(deny.style).toBe(ButtonStyle.Danger);
});

// --- Handler tests ---

test("owner clicking Approve fires allow notification and strikes through prompt", async () => {
  const handler = getHandler();
  const interaction = makeFakeInteraction(OWNER_ID, "please allow foo");
  const { ctx, notification } = makeFakeCtx();

  await handler(interaction as any, ["permission", "allow", "abc"], ctx as any);

  expect(notification.calls.length).toBe(1);
  expect(notification.calls[0][0]).toEqual({
    method: "notifications/claude/channel/permission",
    params: { request_id: "abc", behavior: "allow" },
  });
  expect(interaction.update.calls.length).toBe(1);
  const updateArg = interaction.update.calls[0][0];
  expect(updateArg.content).toContain("~~please allow foo~~");
  expect(updateArg.content).toContain("✅ Approved");
  expect(updateArg.components).toEqual([]);
  expect(interaction.reply.calls.length).toBe(0);
});

test("owner clicking Deny fires deny notification and marks denied", async () => {
  const handler = getHandler();
  const interaction = makeFakeInteraction(OWNER_ID, "please allow bar");
  const { ctx, notification } = makeFakeCtx();

  await handler(interaction as any, ["permission", "deny", "xyz"], ctx as any);

  expect(notification.calls.length).toBe(1);
  expect(notification.calls[0][0]).toEqual({
    method: "notifications/claude/channel/permission",
    params: { request_id: "xyz", behavior: "deny" },
  });
  const updateArg = interaction.update.calls[0][0];
  expect(updateArg.content).toContain("~~please allow bar~~");
  expect(updateArg.content).toContain("❌ Denied");
  expect(updateArg.components).toEqual([]);
});

test("non-owner is rejected ephemerally and no notification fires", async () => {
  const handler = getHandler();
  const interaction = makeFakeInteraction("intruder-id");
  const { ctx, notification } = makeFakeCtx();

  await handler(interaction as any, ["permission", "allow", "abc"], ctx as any);

  expect(notification.calls.length).toBe(0);
  expect(interaction.update.calls.length).toBe(0);
  expect(interaction.reply.calls.length).toBe(1);
  const replyArg = interaction.reply.calls[0][0];
  expect(replyArg.content).toBe("Only the owner can approve permission requests.");
  expect(replyArg.flags).toBe(MessageFlags.Ephemeral);
});

test("missing requestId short-circuits with Invalid permission button", async () => {
  const handler = getHandler();
  const interaction = makeFakeInteraction(OWNER_ID);
  const { ctx, notification } = makeFakeCtx();

  await handler(interaction as any, ["permission", "allow"], ctx as any);

  expect(notification.calls.length).toBe(0);
  expect(interaction.update.calls.length).toBe(0);
  expect(interaction.reply.calls.length).toBe(1);
  expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
});

test("unknown action short-circuits with Invalid permission button", async () => {
  const handler = getHandler();
  const interaction = makeFakeInteraction(OWNER_ID);
  const { ctx, notification } = makeFakeCtx();

  await handler(interaction as any, ["permission", "foo", "abc"], ctx as any);

  expect(notification.calls.length).toBe(0);
  expect(interaction.update.calls.length).toBe(0);
  expect(interaction.reply.calls.length).toBe(1);
  expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
});
