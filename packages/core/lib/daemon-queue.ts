/**
 * Daemon persistence helpers — disk-backed buffers for messages and
 * active conversations. Factored out of daemon.ts so tests can exercise
 * the queue without booting a real daemon (daemon.ts runs main() at import).
 *
 * Pure I/O: no MCP, Discord, or Agent SDK imports.
 */

import { appendFile, readFile, writeFile, unlink, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  deserializeBufferedMessage,
  deserializeConversations,
  serializeBufferedMessage,
  serializeConversations,
  type ConversationActivity,
} from "./daemon-handoff.ts";

export const MAX_BUFFER_LINES = 200;
export const GAP_RECOVERY_WINDOW_MS = 120_000;

export function pendingQueuePath(metaDir: string): string {
  return `${metaDir}/pending-messages.jsonl`;
}

export function conversationsPath(metaDir: string): string {
  return `${metaDir}/active-conversations.json`;
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function appendPendingMessage(
  metaDir: string,
  msg: SDKUserMessage
): Promise<void> {
  const path = pendingQueuePath(metaDir);
  await ensureDir(path);

  // Enforce drop-oldest cap before appending
  let existing: string[] = [];
  try {
    const raw = await readFile(path, "utf-8");
    existing = raw.split("\n").filter((line) => line.length > 0);
  } catch {
    // No file yet — empty buffer
  }

  const line = serializeBufferedMessage(msg);

  if (existing.length >= MAX_BUFFER_LINES) {
    const trimmed = existing.slice(existing.length - MAX_BUFFER_LINES + 1);
    trimmed.push(line);
    await writeFile(path, trimmed.join("\n") + "\n");
    return;
  }

  await appendFile(path, line + "\n");
}

export async function loadPendingQueue(metaDir: string): Promise<SDKUserMessage[]> {
  const path = pendingQueuePath(metaDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }

  const lines = raw.split("\n").filter((line) => line.length > 0);
  const messages: SDKUserMessage[] = [];
  let dropped = 0;

  for (const line of lines) {
    const msg = deserializeBufferedMessage(line);
    if (msg) {
      messages.push(msg);
    } else {
      dropped++;
    }
  }

  if (dropped > 0) {
    console.error(
      `[daemon-queue] Dropped ${dropped} corrupt line(s) from ${path}`
    );
  }

  return messages;
}

export async function clearPendingQueue(metaDir: string): Promise<void> {
  try {
    await unlink(pendingQueuePath(metaDir));
  } catch {
    // Already gone — idempotent
  }
}

export async function saveActiveConversations(
  metaDir: string,
  activity: ConversationActivity[]
): Promise<void> {
  const path = conversationsPath(metaDir);
  await ensureDir(path);
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, serializeConversations(activity));
  await rename(tmpPath, path);
}

export async function loadActiveConversations(
  metaDir: string
): Promise<ConversationActivity[]> {
  const path = conversationsPath(metaDir);
  try {
    const raw = await readFile(path, "utf-8");
    return deserializeConversations(raw);
  } catch {
    return [];
  }
}
