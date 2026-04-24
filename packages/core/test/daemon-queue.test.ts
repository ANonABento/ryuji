import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  MAX_BUFFER_LINES,
  appendPendingMessage,
  clearPendingQueue,
  conversationsPath,
  loadActiveConversations,
  loadPendingQueue,
  pendingQueuePath,
  saveActiveConversations,
} from "../lib/daemon-queue.ts";
import {
  MAX_TRACKED_CONVERSATIONS,
  trackConversationActivity,
  type ConversationActivity,
} from "../lib/daemon-handoff.ts";

let metaDir: string;

beforeEach(async () => {
  metaDir = await mkdtemp(join(tmpdir(), "choomfie-daemon-queue-"));
});

afterEach(async () => {
  await rm(metaDir, { recursive: true, force: true });
});

function makeMessage(id: string, content = "hello"): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: `<channel source="choomfie" chat_id="chat-${id}" message_id="${id}" user="alice" user_id="u1" ts="2026-04-22T10:00:00.000Z" is_dm="true" role="owner">${content}</channel>`,
    },
    parent_tool_use_id: null,
  };
}

test("appendPendingMessage + loadPendingQueue round-trip preserves order", async () => {
  await appendPendingMessage(metaDir, makeMessage("m1"));
  await appendPendingMessage(metaDir, makeMessage("m2"));
  await appendPendingMessage(metaDir, makeMessage("m3"));

  const loaded = await loadPendingQueue(metaDir);
  expect(loaded).toHaveLength(3);

  const texts = loaded.map((m) => {
    const c = m.message?.content;
    return typeof c === "string" ? c : "";
  });
  expect(texts[0]).toContain("message_id=\"m1\"");
  expect(texts[1]).toContain("message_id=\"m2\"");
  expect(texts[2]).toContain("message_id=\"m3\"");
});

test("loadPendingQueue tolerates corrupt lines", async () => {
  await appendPendingMessage(metaDir, makeMessage("m1"));
  await appendFile(pendingQueuePath(metaDir), "not json at all\n");
  await appendPendingMessage(metaDir, makeMessage("m2"));

  const loaded = await loadPendingQueue(metaDir);
  expect(loaded).toHaveLength(2);
});

test("loadPendingQueue returns [] when file missing", async () => {
  const loaded = await loadPendingQueue(metaDir);
  expect(loaded).toEqual([]);
});

test("clearPendingQueue is idempotent on missing file", async () => {
  await expect(clearPendingQueue(metaDir)).resolves.toBeUndefined();
  await appendPendingMessage(metaDir, makeMessage("m1"));
  await clearPendingQueue(metaDir);
  await clearPendingQueue(metaDir); // Second call — still fine
  const loaded = await loadPendingQueue(metaDir);
  expect(loaded).toEqual([]);
});

test("appendPendingMessage enforces MAX_BUFFER_LINES cap (drop oldest)", async () => {
  // Append one more than the cap; the oldest should get dropped
  const total = MAX_BUFFER_LINES + 3;
  for (let i = 0; i < total; i++) {
    await appendPendingMessage(metaDir, makeMessage(`m${i}`));
  }

  const loaded = await loadPendingQueue(metaDir);
  expect(loaded.length).toBeLessThanOrEqual(MAX_BUFFER_LINES);
  // Oldest (m0) should be dropped; newest should still be there
  const lastContent = loaded[loaded.length - 1].message?.content as string;
  expect(lastContent).toContain(`message_id="m${total - 1}"`);
  const firstContent = loaded[0].message?.content as string;
  expect(firstContent).not.toContain(`message_id="m0"`);
});

test("saveActiveConversations + loadActiveConversations round-trip", async () => {
  const msg1 = makeMessage("mA", "hi from DM");
  const msg2 = makeMessage("mB", "hi from guild");
  // Flip the second to be a guild message
  msg2.message.content = (msg2.message.content as string).replace(
    'is_dm="true"',
    'is_dm="false"'
  );

  let conversations = trackConversationActivity([], msg1);
  conversations = trackConversationActivity(conversations, msg2);

  await saveActiveConversations(metaDir, conversations);
  const loaded = await loadActiveConversations(metaDir);

  expect(loaded).toHaveLength(2);
  const chatIds = loaded.map((c) => c.chatId).sort();
  expect(chatIds).toContain("chat-mA");
  expect(chatIds).toContain("chat-mB");
});

test("loadActiveConversations drops entries beyond MAX_TRACKED_CONVERSATIONS", async () => {
  const overCap: ConversationActivity[] = [];
  for (let i = 0; i < MAX_TRACKED_CONVERSATIONS + 5; i++) {
    overCap.push({
      chatId: `c-${i}`,
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
  // Bypass the serializer's cap (it would also cap) by writing directly
  await writeFile(conversationsPath(metaDir), JSON.stringify(overCap));

  const loaded = await loadActiveConversations(metaDir);
  expect(loaded).toHaveLength(MAX_TRACKED_CONVERSATIONS);
});

test("loadActiveConversations returns [] on corrupt JSON", async () => {
  await writeFile(conversationsPath(metaDir), "totally invalid json");
  const loaded = await loadActiveConversations(metaDir);
  expect(loaded).toEqual([]);
});

test("loadActiveConversations returns [] when file missing", async () => {
  const loaded = await loadActiveConversations(metaDir);
  expect(loaded).toEqual([]);
});
