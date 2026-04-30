import type { Message } from "discord.js";
import type { AppContext } from "../types.ts";
import { refreshChannel } from "../conversation.ts";
import { onReplySent } from "../typing.ts";
import { createChatProvider, type ChatMessage } from "./index.ts";

const DISCORD_LIMIT = 2000;
const STREAM_EDIT_INTERVAL_MS = 1200;
const STREAM_PREVIEW_LIMIT = 1900;
const ERROR_PREFIX = "Chat provider error: ";

function buildSystemPrompt(ctx: AppContext): string {
  const activePersona = ctx.config.getActivePersona();
  return [
    `You are ${activePersona.name}. ${activePersona.personality}`,
    "",
    "You are chatting in Discord. Reply directly with the message text the user should see.",
    "Keep replies concise unless the user asks for detail. Do not describe tool calls or terminal output.",
    "",
    ctx.memory.buildMemoryContext(),
    "",
    ...ctx.plugins.flatMap((p) => p.instructions ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeDiscordAttribute(value: string | undefined): string {
  return (value ?? "").replace(/[&"<>]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "\"":
        return "&quot;";
      case "<":
        return "&lt;";
      default:
        return "&gt;";
    }
  });
}

export function formatDiscordUserMessage(
  content: string,
  meta: Record<string, string>
): string {
  const attributes = [
    ["chat_id", meta.chat_id],
    ["message_id", meta.message_id],
    ["user", meta.user],
    ["user_id", meta.user_id],
    ["role", meta.role],
    ["is_dm", meta.is_dm],
  ]
    .map(([key, value]) => `${key}="${escapeDiscordAttribute(value)}"`)
    .join(" ");
  const lines = [
    `<discord_message ${attributes}>`,
    content,
    "</discord_message>",
  ];

  if (meta.attachments) {
    lines.push("", `Attachments: ${meta.attachments}`);
  }

  return lines.join("\n");
}

export function splitDiscordContent(content: string): string[] {
  const chunks: string[] = [];
  let remaining = content.trim() || "(no response)";

  while (remaining.length > DISCORD_LIMIT) {
    let splitAt = remaining.lastIndexOf("\n", DISCORD_LIMIT);
    if (splitAt < DISCORD_LIMIT * 0.5) {
      splitAt = remaining.lastIndexOf(" ", DISCORD_LIMIT);
    }
    if (splitAt < DISCORD_LIMIT * 0.5) splitAt = DISCORD_LIMIT;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

function previewContent(content: string): string {
  if (content.length <= STREAM_PREVIEW_LIMIT) return content;
  return `${content.slice(0, STREAM_PREVIEW_LIMIT - 3).trimEnd()}...`;
}

export function formatProviderError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error == null
        ? "unknown error"
        : String(error);
  const limit = DISCORD_LIMIT - ERROR_PREFIX.length;
  const detail =
    message.length <= limit ? message : `${message.slice(0, limit - 3).trimEnd()}...`;
  return `${ERROR_PREFIX}${detail}`;
}

function canSend(channel: Message["channel"]): channel is Message["channel"] & {
  send: Message["reply"];
} {
  return "send" in channel && typeof channel.send === "function";
}

export async function handleProviderChat(
  message: Message,
  ctx: AppContext,
  content: string,
  meta: Record<string, string>
): Promise<boolean> {
  const provider = createChatProvider(ctx.config);
  if (!provider) return false;

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(ctx) },
    { role: "user", content: formatDiscordUserMessage(content, meta) },
  ];

  let sent = await message.reply({
    content: "...",
    allowedMentions: { repliedUser: false },
  });
  let fullText = "";
  let lastEditAt = 0;

  try {
    for await (const chunk of provider.stream(messages)) {
      fullText += chunk;
      const now = Date.now();
      if (now - lastEditAt >= STREAM_EDIT_INTERVAL_MS) {
        lastEditAt = now;
        await sent.edit(previewContent(fullText) || "...");
      }
    }

    const chunks = splitDiscordContent(fullText);
    await sent.edit(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      if (!canSend(message.channel)) break;
      sent = await message.channel.send({
        content: chunk,
        allowedMentions: { repliedUser: false },
      });
    }

    ctx.messageStats.sent += chunks.length;
    refreshChannel(ctx.activeChannels, message.channelId);
    onReplySent(message.channelId);
  } catch (error) {
    await sent.edit(formatProviderError(error));
    onReplySent(message.channelId);
  }

  return true;
}
