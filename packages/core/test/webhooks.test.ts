import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType } from "discord.js";
import { MemoryStore } from "../lib/memory.ts";
import { handleWebhookRequest } from "../lib/webhooks.ts";
import type { WebhookContext, WebhookTextChannel } from "../lib/webhooks.ts";

const tempDirs: string[] = [];
const memories: MemoryStore[] = [];

afterEach(async () => {
  for (const memory of memories.splice(0)) {
    memory.close();
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeMemory(): Promise<MemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-webhooks-"));
  tempDirs.push(dir);
  const memory = new MemoryStore(join(dir, "choomfie.db"));
  memories.push(memory);
  return memory;
}

interface FakeTextChannel extends WebhookTextChannel {
  id: string;
  type: ChannelType.GuildText;
  isTextBased(): true;
}

function fakeTextChannel(
  id: string,
  send: WebhookTextChannel["send"]
): FakeTextChannel {
  return {
    id,
    type: ChannelType.GuildText,
    isTextBased: () => true,
    send,
  };
}

function fakeContext(memory: MemoryStore, sent: string[]): WebhookContext {
  return {
    memory,
    discord: {
      channels: {
        fetch: async (id: string) =>
          fakeTextChannel(id, async (message) => {
            sent.push(message.content);
          }),
      },
    },
  };
}

function fakeContextWithBrokenChannel(memory: MemoryStore): WebhookContext {
  return {
    memory,
    discord: {
      channels: {
        fetch: async () =>
          fakeTextChannel("chan_broken", async () => {
            throw new Error("Cannot post in this channel");
          }),
      },
    },
  };
}

test("MemoryStore persists and revokes incoming webhooks", async () => {
  const memory = await makeMemory();
  memory.addIncomingWebhook("tok_123", "chan_1", "owner_1", "guild_1");

  const saved = memory.getIncomingWebhook("tok_123");
  expect(saved?.channelId).toBe("chan_1");
  expect(saved?.guildId).toBe("guild_1");
  expect(memory.listIncomingWebhooks()).toHaveLength(1);

  expect(memory.revokeIncomingWebhook("tok_123")).toBe(true);
  expect(memory.getIncomingWebhook("tok_123")).toBeNull();
  expect(memory.listIncomingWebhooks()).toHaveLength(0);
  expect(memory.listIncomingWebhooks(true)[0]?.revokedAt).toBeTruthy();
});

test("webhook endpoint posts JSON content to the configured Discord channel", async () => {
  const memory = await makeMemory();
  const sent: string[] = [];
  memory.addIncomingWebhook("tok_abc", "chan_2", "owner_1");

  const response = await handleWebhookRequest(
    new Request("http://localhost:8787/webhook/tok_abc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "ship it" }),
    }),
    fakeContext(memory, sent)
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(sent).toEqual(["ship it"]);
});

test("webhook endpoint posts plain text payloads", async () => {
  const memory = await makeMemory();
  const sent: string[] = [];
  memory.addIncomingWebhook("tok_plain", "chan_3", "owner_1");

  const response = await handleWebhookRequest(
    new Request("http://localhost:8787/webhook/tok_plain", {
      method: "POST",
      body: "simple text",
    }),
    fakeContext(memory, sent)
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(sent).toEqual(["simple text"]);
});

test("webhook endpoint handles channel send failures with 502", async () => {
  const memory = await makeMemory();
  const sent: string[] = [];
  memory.addIncomingWebhook("tok_broken", "chan_broken", "owner_1");

  const response = await handleWebhookRequest(
    new Request("http://localhost:8787/webhook/tok_broken", {
      method: "POST",
      body: "will fail",
    }),
    fakeContextWithBrokenChannel(memory)
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "channel_unavailable" });
  expect(sent).toEqual([]);
});

test("webhook endpoint rejects revoked tokens", async () => {
  const memory = await makeMemory();
  const sent: string[] = [];
  memory.addIncomingWebhook("tok_revoked", "chan_2", "owner_1");
  memory.revokeIncomingWebhook("tok_revoked");

  const response = await handleWebhookRequest(
    new Request("http://localhost:8787/webhook/tok_revoked", {
      method: "POST",
      body: "nope",
    }),
    fakeContext(memory, sent)
  );

  expect(response.status).toBe(404);
  expect(sent).toEqual([]);
});

test("webhook endpoint rejects malformed encoded tokens", async () => {
  const memory = await makeMemory();
  const sent: string[] = [];

  const response = await handleWebhookRequest(
    new Request("http://localhost:8787/webhook/%E0%A4%A", {
      method: "POST",
      body: "nope",
    }),
    fakeContext(memory, sent)
  );

  expect(response.status).toBe(404);
  expect(sent).toEqual([]);
});
