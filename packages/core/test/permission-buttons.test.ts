import { describe, expect, test, beforeAll } from "bun:test";
import { ButtonStyle, MessageFlags } from "discord.js";
import { buttonHandlers } from "@choomfie/shared";
import {
  buildPermissionMessage,
  buildPermissionTextFallback,
} from "../lib/handlers/permission-buttons.ts";

beforeAll(async () => {
  // Side-effect: registers the "permission" button handler.
  await import("../lib/handlers/permission-buttons.ts");
});

type Spy = ((...args: any[]) => any) & { calls: any[][] };
function spy(): Spy {
  const fn: any = (...args: any[]) => {
    fn.calls.push(args);
  };
  fn.calls = [];
  return fn;
}

const baseParams = {
  request_id: "abcde",
  tool_name: "Bash",
  description: "Run command",
  input_preview: "ls -la",
};

describe("buildPermissionMessage", () => {
  test("produces an embed and one row with two buttons", () => {
    const msg = buildPermissionMessage(baseParams);
    expect(msg.embeds).toHaveLength(1);
    expect(msg.components).toHaveLength(1);
    const row = (msg.components![0] as any).toJSON();
    expect(row.components).toHaveLength(2);
  });

  test("Approve button: customId, style, label, emoji", () => {
    const msg = buildPermissionMessage(baseParams);
    const row = (msg.components![0] as any).toJSON();
    const approve = row.components[0];
    expect(approve.custom_id).toBe("permission:allow:abcde");
    expect(approve.style).toBe(ButtonStyle.Success);
    expect(approve.label).toBe("Approve");
    expect(approve.emoji?.name).toBe("✅");
  });

  test("Deny button: customId, style, label, emoji", () => {
    const msg = buildPermissionMessage(baseParams);
    const row = (msg.components![0] as any).toJSON();
    const deny = row.components[1];
    expect(deny.custom_id).toBe("permission:deny:abcde");
    expect(deny.style).toBe(ButtonStyle.Danger);
    expect(deny.label).toBe("Deny");
    expect(deny.emoji?.name).toBe("❌");
  });

  test("input_preview is truncated to 1000 chars in embed", () => {
    const big = "x".repeat(2000);
    const msg = buildPermissionMessage({ ...baseParams, input_preview: big });
    const embed = (msg.embeds![0] as any).toJSON();
    const previewField = embed.fields.find((f: any) => f.name === "Preview");
    // Field has fences ```...``` so length is 1000 + ~8 (fences + newlines)
    expect(previewField.value.length).toBeLessThanOrEqual(1024);
    expect(previewField.value).toContain("xxxx");
  });
});

describe("buildPermissionTextFallback", () => {
  test("preserves the `yes <code>` / `no <code>` hint required by PERMISSION_REPLY_RE", () => {
    const text = buildPermissionTextFallback(baseParams);
    expect(text).toContain("yes abcde");
    expect(text).toContain("no abcde");
    expect(text).toContain("Bash");
    expect(text).toContain("Run command");
    expect(text).toContain("ls -la");
  });

  test("input_preview is truncated to 1000 chars (matches embed truncation)", () => {
    const big = "x".repeat(2000);
    const text = buildPermissionTextFallback({ ...baseParams, input_preview: big });
    // Full message must fit within Discord's 2000-char limit
    expect(text.length).toBeLessThan(2000);
    // Preview section should not exceed 1000 content chars + fences
    const fenceStart = text.indexOf("```\n") + 4;
    const fenceEnd = text.indexOf("\n```", fenceStart);
    expect(fenceEnd - fenceStart).toBe(1000);
  });
});

describe("permission button handler", () => {
  test("registry has 'permission' handler", () => {
    expect(buttonHandlers.has("permission")).toBe(true);
  });

  function makeFakes(userId = "owner-id") {
    const interaction = {
      user: { id: userId },
      message: { embeds: [{ data: { title: "Permission Request" } } as any] },
      reply: spy(),
      update: spy(),
    } as any;
    const ctx = {
      ownerUserId: "owner-id",
      mcp: { notification: spy() },
    } as any;
    return { interaction, ctx };
  }

  test("owner click 'allow' fires notification and updates message", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await handler(interaction, ["permission", "allow", "abcde"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(1);
    const [arg] = ctx.mcp.notification.calls[0];
    expect(arg.method).toBe("notifications/claude/channel/permission");
    expect(arg.params).toEqual({ request_id: "abcde", behavior: "allow" });

    expect(interaction.update.calls).toHaveLength(1);
    const updateArg = interaction.update.calls[0][0];
    expect(updateArg.components).toEqual([]);
    expect(updateArg.embeds).toHaveLength(1);
    expect(interaction.reply.calls).toHaveLength(0);
  });

  test("owner click 'deny' fires notification with deny behavior", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await handler(interaction, ["permission", "deny", "abcde"], ctx);

    expect(ctx.mcp.notification.calls[0][0].params).toEqual({
      request_id: "abcde",
      behavior: "deny",
    });
    expect(interaction.update.calls).toHaveLength(1);
  });

  test("non-owner click is rejected, no notification fired", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes("intruder-id");
    await handler(interaction, ["permission", "allow", "abcde"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(0);
    expect(interaction.update.calls).toHaveLength(0);
    expect(interaction.reply.calls).toHaveLength(1);
    const replyArg = interaction.reply.calls[0][0];
    expect(replyArg.content).toContain("Only the owner");
    expect(replyArg.flags).toBe(MessageFlags.Ephemeral);
  });

  test("missing requestId rejected with 'Invalid permission button.'", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await handler(interaction, ["permission", "allow"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(0);
    expect(interaction.reply.calls).toHaveLength(1);
    expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
  });

  test("unknown action ('foo') rejected — does NOT silently default to deny", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await handler(interaction, ["permission", "foo", "abcde"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(0);
    expect(interaction.update.calls).toHaveLength(0);
    expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
  });

  test("requestId is lowercased before firing notification", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await handler(interaction, ["permission", "allow", "ABCDE"], ctx);

    expect(ctx.mcp.notification.calls[0][0].params.request_id).toBe("abcde");
  });
});
