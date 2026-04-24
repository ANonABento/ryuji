import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

const CHANNEL_OPEN_TAG_RE = /^<channel\s+([^>]+)>([\s\S]*)$/i;
const CHANNEL_ATTR_RE = /([a-z_]+)="([^"]*)"/gi;
export const MAX_TRACKED_CONVERSATIONS = 12;
const MAX_PREVIEW_LENGTH = 240;

export type ConversationActivity = {
  chatId: string;
  messageId: string | null;
  user: string | null;
  userId: string | null;
  role: string | null;
  isDm: boolean;
  conversationMode: boolean;
  replyToUser: string | null;
  attachmentCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  messageCount: number;
};

type ParsedChannelMessage = {
  attrs: Record<string, string>;
  content: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractUserMessageText(msg: SDKUserMessage): string {
  const content = msg.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function parseChannelMessage(msg: SDKUserMessage): ParsedChannelMessage | null {
  if (msg.isSynthetic) return null;

  const rawText = extractUserMessageText(msg).trim();
  if (!rawText.startsWith("<channel")) return null;

  const match = CHANNEL_OPEN_TAG_RE.exec(rawText);
  if (!match) return null;

  const attrs: Record<string, string> = {};
  for (const attr of match[1].matchAll(CHANNEL_ATTR_RE)) {
    attrs[attr[1]] = attr[2];
  }

  if (!attrs.chat_id) return null;

  const content = normalizeWhitespace(
    match[2]
      .replace(/<\/channel>\s*$/i, "")
      .trim()
  );

  return { attrs, content };
}

export function trackConversationActivity(
  existing: ConversationActivity[],
  msg: SDKUserMessage,
  receivedAt = new Date().toISOString()
): ConversationActivity[] {
  const parsed = parseChannelMessage(msg);
  if (!parsed) return existing;

  const previous = existing.find((entry) => entry.chatId === parsed.attrs.chat_id);
  const nextEntry: ConversationActivity = {
    chatId: parsed.attrs.chat_id,
    messageId: parsed.attrs.message_id ?? null,
    user: parsed.attrs.user ?? previous?.user ?? null,
    userId: parsed.attrs.user_id ?? previous?.userId ?? null,
    role: parsed.attrs.role ?? previous?.role ?? null,
    isDm: parsed.attrs.is_dm === "true",
    conversationMode: parsed.attrs.conversation_mode === "true",
    replyToUser: parsed.attrs.reply_to_user ?? null,
    attachmentCount: Number(parsed.attrs.attachment_count ?? 0) || 0,
    lastMessagePreview:
      parsed.content.length > 0
        ? parsed.content.slice(0, MAX_PREVIEW_LENGTH)
        : "(empty message)",
    lastMessageAt: parsed.attrs.ts ?? msg.timestamp ?? receivedAt,
    messageCount: (previous?.messageCount ?? 0) + 1,
  };

  return [nextEntry, ...existing.filter((entry) => entry.chatId !== nextEntry.chatId)].slice(
    0,
    MAX_TRACKED_CONVERSATIONS
  );
}

export function buildConversationHandoffSection(
  conversations: ConversationActivity[],
  bufferedMessages: number
): string {
  const lines = ["## Active Conversations"];

  if (conversations.length === 0) {
    lines.push("- No active Discord conversations observed by daemon.");
  } else {
    for (const conversation of conversations) {
      const mode = conversation.isDm ? "DM" : "Guild";
      const tags = [
        mode,
        conversation.role ? `role=${conversation.role}` : null,
        conversation.conversationMode ? "conversation_mode" : null,
        conversation.replyToUser ? `reply_to=${conversation.replyToUser}` : null,
        conversation.attachmentCount > 0 ? `attachments=${conversation.attachmentCount}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      const who = conversation.user
        ? `${conversation.user}${conversation.userId ? ` (${conversation.userId})` : ""}`
        : conversation.userId ?? "unknown user";

      lines.push(
        `- chat_id=${conversation.chatId} with ${who} at ${conversation.lastMessageAt} [${tags}] :: ${conversation.lastMessagePreview}`
      );
    }
  }

  lines.push("");
  lines.push("## Buffered Discord Messages");
  if (bufferedMessages === 0) {
    lines.push("- No buffered Discord messages awaiting replay.");
  } else {
    lines.push(`- ${bufferedMessages} message(s) buffered for replay into the next ACTIVE session.`);
  }

  return lines.join("\n");
}

export function composeHandoffSummary(
  modelSummary: string,
  conversations: ConversationActivity[],
  bufferedMessages: number
): string {
  const trimmed = modelSummary.trim();
  const sections = [
    trimmed.length > 0 ? trimmed : "No model-generated handoff summary available.",
    buildConversationHandoffSection(conversations, bufferedMessages),
  ];

  return sections.join("\n\n");
}

export function cloneBufferedMessage(msg: SDKUserMessage): SDKUserMessage {
  return {
    ...msg,
    message: { ...msg.message },
    session_id: undefined,
    uuid: undefined,
  };
}

export function serializeBufferedMessage(msg: SDKUserMessage): string {
  const replayReady = cloneBufferedMessage(msg);
  return JSON.stringify(replayReady);
}

export function deserializeBufferedMessage(line: string): SDKUserMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type !== "user") return null;
    if (!parsed.message || parsed.message.content === undefined) return null;
    return parsed as SDKUserMessage;
  } catch {
    return null;
  }
}

export function serializeConversations(activity: ConversationActivity[]): string {
  return JSON.stringify(activity, null, 2);
}

export function deserializeConversations(json: string): ConversationActivity[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is ConversationActivity =>
          entry && typeof entry === "object" && typeof entry.chatId === "string"
      )
      .slice(0, MAX_TRACKED_CONVERSATIONS);
  } catch {
    return [];
  }
}
