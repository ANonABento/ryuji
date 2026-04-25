import { describe, expect, test, beforeAll } from "bun:test";
import { ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { buttonHandlers, type ButtonHandler } from "@choomfie/shared";
import {
  buildPermissionMessage,
  buildPermissionTextFallback,
  type PermissionRequestParams,
} from "../lib/handlers/permission-buttons.ts";

beforeAll(async () => {
  // Side-effect: registers the "permission" button handler.
  await import("../lib/handlers/permission-buttons.ts");
});

type Spy<Args extends unknown[] = unknown[]> = ((...args: Args) => void) & {
  calls: Args[];
};

function spy<Args extends unknown[] = unknown[]>(): Spy<Args> {
  const fn = ((...args: Args) => {
    fn.calls.push(args);
  }) as Spy<Args>;
  fn.calls = [];
  return fn;
}

type PermissionButtonJson = {
  custom_id: string;
  style: ButtonStyle;
  label: string;
  emoji?: { name?: string };
};

type PermissionRowJson = {
  components: PermissionButtonJson[];
};

type PermissionEmbedJson = {
  fields: Array<{ name: string; value: string }>;
};

type JsonEncodable<T> = {
  toJSON(): T;
};

type PermissionReplyPayload = {
  content: string;
  flags?: MessageFlags;
};

type PermissionUpdatePayload = {
  embeds?: unknown[];
  components?: unknown[];
};

type PermissionNotification = {
  method: string;
  params: {
    request_id: string;
    behavior: "allow" | "deny";
  };
};

function permissionRow(params: PermissionRequestParams): PermissionRowJson {
  const msg = buildPermissionMessage(params);
  const row = msg.components?.[0] as JsonEncodable<PermissionRowJson> | undefined;
  if (!row) throw new Error("Expected permission action row");
  return row.toJSON();
}

function permissionEmbed(params: PermissionRequestParams): PermissionEmbedJson {
  const msg = buildPermissionMessage(params);
  const embed = msg.embeds?.[0] as JsonEncodable<PermissionEmbedJson> | undefined;
  if (!embed) throw new Error("Expected permission embed");
  return embed.toJSON();
}

const baseParams: PermissionRequestParams = {
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
    const row = permissionRow(baseParams);
    expect(row.components).toHaveLength(2);
  });

  test("Approve button: customId, style, label, emoji", () => {
    const row = permissionRow(baseParams);
    const approve = row.components[0];
    expect(approve.custom_id).toBe("permission:allow:abcde");
    expect(approve.style).toBe(ButtonStyle.Success);
    expect(approve.label).toBe("Approve");
    expect(approve.emoji?.name).toBe("✅");
  });

  test("Deny button: customId, style, label, emoji", () => {
    const row = permissionRow(baseParams);
    const deny = row.components[1];
    expect(deny.custom_id).toBe("permission:deny:abcde");
    expect(deny.style).toBe(ButtonStyle.Danger);
    expect(deny.label).toBe("Deny");
    expect(deny.emoji?.name).toBe("❌");
  });

  test("input_preview is truncated to 1000 chars in embed", () => {
    const big = "x".repeat(2000);
    const embed = permissionEmbed({ ...baseParams, input_preview: big });
    const previewField = embed.fields.find((f) => f.name === "Preview");
    // Field has fences ```...``` so length is 1000 + ~8 (fences + newlines)
    expect(previewField?.value.length).toBeLessThanOrEqual(1024);
    expect(previewField?.value).toContain("xxxx");
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
      message: { embeds: [new EmbedBuilder().setTitle("Permission Request")] },
      reply: spy<[PermissionReplyPayload]>(),
      update: spy<[PermissionUpdatePayload]>(),
    };
    const ctx = {
      ownerUserId: "owner-id",
      mcp: { notification: spy<[PermissionNotification]>() },
    };
    return { interaction, ctx };
  }

  async function callHandler(
    handler: ButtonHandler,
    interaction: ReturnType<typeof makeFakes>["interaction"],
    parts: string[],
    ctx: ReturnType<typeof makeFakes>["ctx"]
  ): Promise<void> {
    await handler(
      interaction as unknown as Parameters<ButtonHandler>[0],
      parts,
      ctx as unknown as Parameters<ButtonHandler>[2]
    );
  }

  test("owner click 'allow' fires notification and updates message", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await callHandler(handler, interaction, ["permission", "allow", "abcde"], ctx);

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
    await callHandler(handler, interaction, ["permission", "deny", "abcde"], ctx);

    expect(ctx.mcp.notification.calls[0][0].params).toEqual({
      request_id: "abcde",
      behavior: "deny",
    });
    expect(interaction.update.calls).toHaveLength(1);
  });

  test("non-owner click is rejected, no notification fired", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes("intruder-id");
    await callHandler(handler, interaction, ["permission", "allow", "abcde"], ctx);

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
    await callHandler(handler, interaction, ["permission", "allow"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(0);
    expect(interaction.reply.calls).toHaveLength(1);
    expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
  });

  test("unknown action ('foo') rejected — does NOT silently default to deny", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await callHandler(handler, interaction, ["permission", "foo", "abcde"], ctx);

    expect(ctx.mcp.notification.calls).toHaveLength(0);
    expect(interaction.update.calls).toHaveLength(0);
    expect(interaction.reply.calls[0][0].content).toBe("Invalid permission button.");
  });

  test("requestId is lowercased before firing notification", async () => {
    const handler = buttonHandlers.get("permission")!;
    const { interaction, ctx } = makeFakes();
    await callHandler(handler, interaction, ["permission", "allow", "ABCDE"], ctx);

    expect(ctx.mcp.notification.calls[0][0].params.request_id).toBe("abcde");
  });
});
