import { expect, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  MAX_TRACKED_CONVERSATIONS,
  buildConversationHandoffSection,
  cloneBufferedMessage,
  composeHandoffSummary,
  deserializeBufferedMessage,
  deserializeConversations,
  extractUserMessageText,
  parseChannelMessage,
  serializeBufferedMessage,
  serializeConversations,
  trackConversationActivity,
  type ConversationActivity,
} from "../lib/daemon-handoff.ts";

function makeChannelMessage(
  content: string,
  overrides: Partial<SDKUserMessage> = {}
): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
    ...overrides,
  };
}

test("parseChannelMessage extracts metadata and body", () => {
  const msg = makeChannelMessage(
    '<channel source="choomfie" chat_id="123" message_id="m1" user="becca" user_id="u1" ts="2026-04-22T10:00:00.000Z" is_dm="true" role="owner" conversation_mode="true">Need a reminder about rent</channel>'
  );

  const parsed = parseChannelMessage(msg);

  expect(parsed).not.toBeNull();
  expect(parsed?.attrs.chat_id).toBe("123");
  expect(parsed?.attrs.user).toBe("becca");
  expect(parsed?.content).toBe("Need a reminder about rent");
});

test("trackConversationActivity updates existing chat and keeps newest first", () => {
  const first = makeChannelMessage(
    '<channel source="choomfie" chat_id="alpha" message_id="m1" user="becca" user_id="u1" ts="2026-04-22T10:00:00.000Z" is_dm="true" role="owner">first ping</channel>'
  );
  const second = makeChannelMessage(
    '<channel source="choomfie" chat_id="beta" message_id="m2" user="vik" user_id="u2" ts="2026-04-22T10:01:00.000Z" is_dm="false" role="user">hello there</channel>'
  );
  const third = makeChannelMessage(
    '<channel source="choomfie" chat_id="alpha" message_id="m3" user="becca" user_id="u1" ts="2026-04-22T10:02:00.000Z" is_dm="true" role="owner" attachment_count="1">follow up</channel>'
  );

  let conversations = trackConversationActivity([], first);
  conversations = trackConversationActivity(conversations, second);
  conversations = trackConversationActivity(conversations, third);

  expect(conversations).toHaveLength(2);
  expect(conversations[0].chatId).toBe("alpha");
  expect(conversations[0].messageCount).toBe(2);
  expect(conversations[0].attachmentCount).toBe(1);
  expect(conversations[0].lastMessagePreview).toBe("follow up");
  expect(conversations[1].chatId).toBe("beta");
});

test("composeHandoffSummary appends active conversations and buffer info", () => {
  const msg = makeChannelMessage(
    '<channel source="choomfie" chat_id="123" message_id="m1" user="becca" user_id="u1" ts="2026-04-22T10:00:00.000Z" is_dm="true" role="owner">Need a reminder about rent</channel>'
  );
  const conversations = trackConversationActivity([], msg);

  const summary = composeHandoffSummary("Model summary here.", conversations, 2);

  expect(summary).toContain("Model summary here.");
  expect(summary).toContain("## Active Conversations");
  expect(summary).toContain("chat_id=123");
  expect(summary).toContain("Need a reminder about rent");
  expect(summary).toContain("2 message(s) buffered for replay");
});

test("cloneBufferedMessage clears session-specific ids before replay", () => {
  const original = makeChannelMessage("<channel chat_id=\"123\">hi</channel>", {
    timestamp: "2026-04-22T10:00:00.000Z",
    uuid: "abc-123" as any,
    session_id: "session-1",
  });

  const cloned = cloneBufferedMessage(original);

  expect(cloned).not.toBe(original);
  expect(cloned.session_id).toBeUndefined();
  expect(cloned.uuid).toBeUndefined();
  expect(extractUserMessageText(cloned)).toBe("<channel chat_id=\"123\">hi</channel>");
});

test("buildConversationHandoffSection handles empty state", () => {
  const section = buildConversationHandoffSection([], 0);

  expect(section).toContain("No active Discord conversations observed by daemon.");
  expect(section).toContain("No buffered Discord messages awaiting replay.");
});

test("serializeBufferedMessage + deserializeBufferedMessage round-trip clears session_id and uuid", () => {
  const original = makeChannelMessage(
    '<channel chat_id="123">hello</channel>',
    {
      timestamp: "2026-04-22T10:00:00.000Z",
      uuid: "abc-123" as any,
      session_id: "session-1",
    }
  );

  const line = serializeBufferedMessage(original);
  const parsed = JSON.parse(line);
  expect(parsed.session_id).toBeUndefined();
  expect(parsed.uuid).toBeUndefined();

  const restored = deserializeBufferedMessage(line);
  expect(restored).not.toBeNull();
  expect(restored?.session_id).toBeUndefined();
  expect(restored?.uuid).toBeUndefined();
  expect(extractUserMessageText(restored!)).toBe('<channel chat_id="123">hello</channel>');
});

test("deserializeBufferedMessage returns null on non-JSON input", () => {
  expect(deserializeBufferedMessage("not json")).toBeNull();
  expect(deserializeBufferedMessage("")).toBeNull();
  expect(deserializeBufferedMessage("{malformed")).toBeNull();
});

test("deserializeBufferedMessage rejects wrong message type", () => {
  const assistantLine = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: "hi" },
  });
  expect(deserializeBufferedMessage(assistantLine)).toBeNull();

  const resultLine = JSON.stringify({ type: "result", subtype: "success" });
  expect(deserializeBufferedMessage(resultLine)).toBeNull();

  const emptyObj = JSON.stringify({});
  expect(deserializeBufferedMessage(emptyObj)).toBeNull();
});

test("serializeConversations + deserializeConversations round-trip preserves fields", () => {
  const msg = makeChannelMessage(
    '<channel source="choomfie" chat_id="123" message_id="m1" user="becca" user_id="u1" ts="2026-04-22T10:00:00.000Z" is_dm="true" role="owner" attachment_count="2">note</channel>'
  );
  const conversations = trackConversationActivity([], msg);

  const json = serializeConversations(conversations);
  const restored = deserializeConversations(json);

  expect(restored).toHaveLength(1);
  expect(restored[0].chatId).toBe("123");
  expect(restored[0].messageId).toBe("m1");
  expect(restored[0].user).toBe("becca");
  expect(restored[0].isDm).toBe(true);
  expect(restored[0].attachmentCount).toBe(2);
  expect(restored[0].lastMessagePreview).toBe("note");
});

test("deserializeConversations caps at MAX_TRACKED_CONVERSATIONS", () => {
  const overCap: ConversationActivity[] = [];
  for (let i = 0; i < MAX_TRACKED_CONVERSATIONS + 5; i++) {
    overCap.push({
      chatId: `chat-${i}`,
      messageId: `m-${i}`,
      user: "u",
      userId: "uid",
      role: "user",
      isDm: true,
      conversationMode: false,
      replyToUser: null,
      attachmentCount: 0,
      lastMessagePreview: "p",
      lastMessageAt: "2026-04-22T10:00:00.000Z",
      messageCount: 1,
    });
  }

  const json = JSON.stringify(overCap);
  const restored = deserializeConversations(json);
  expect(restored).toHaveLength(MAX_TRACKED_CONVERSATIONS);
});

test("deserializeConversations returns [] on corrupt JSON", () => {
  expect(deserializeConversations("not-json")).toEqual([]);
  expect(deserializeConversations("{}")).toEqual([]);
  expect(deserializeConversations("[1, 2, 3]")).toEqual([]);
});
