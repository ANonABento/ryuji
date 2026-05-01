import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager, DEFAULT_OLLAMA_MODEL } from "../lib/config.ts";
import { OllamaProvider } from "../lib/chat/ollama-provider.ts";
import {
  formatDiscordUserMessage,
  formatProviderError,
  splitDiscordContent,
} from "../lib/chat/discord-chat.ts";

const originalFetch = globalThis.fetch;

interface OllamaChatRequest {
  model: string;
  stream: boolean;
  messages: Array<{ role: string; content: string }>;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("OllamaProvider maps chat messages and streams response chunks", async () => {
  const body = [
    JSON.stringify({ message: { role: "assistant", content: "hel" }, done: false }),
    JSON.stringify({ message: { role: "assistant", content: "lo" }, done: true }),
  ].join("\n");

  let requestBody: OllamaChatRequest | undefined;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as OllamaChatRequest;
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const provider = new OllamaProvider(DEFAULT_OLLAMA_MODEL);
  let result = "";
  for await (const chunk of provider.stream([
    { role: "system", content: "Be concise." },
    { role: "user", content: "Say hello." },
  ])) {
    result += chunk;
  }

  expect(requestBody).toEqual({
    model: DEFAULT_OLLAMA_MODEL,
    stream: true,
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Say hello." },
    ],
  });
  expect(result).toBe("hello");
});

test("OllamaProvider handles UTF-8 bytes split across stream chunks", async () => {
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      message: { role: "assistant", content: "hi \u2603" },
      done: true,
    })
  );
  const snowman = new TextEncoder().encode("\u2603");
  const splitAt =
    encoded.findIndex((byte, index) =>
      snowman.every(
        (snowmanByte, offset) => encoded[index + offset] === snowmanByte
      )
    ) + 1;
  expect(splitAt).toBeGreaterThan(0);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    },
  });

  globalThis.fetch = (async () =>
    new Response(stream, { status: 200 })) as typeof fetch;

  const provider = new OllamaProvider(DEFAULT_OLLAMA_MODEL);
  let result = "";
  for await (const chunk of provider.stream([
    { role: "user", content: "Say hi." },
  ])) {
    result += chunk;
  }

  expect(result).toBe("hi \u2603");
});

test("ConfigManager defaults Ollama model while preserving Claude provider default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-config-"));
  try {
    const config = new ConfigManager(dir);
    expect(config.getProvider()).toBe("claude");
    expect(config.getOllamaModel()).toBe(DEFAULT_OLLAMA_MODEL);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigManager trims saved Ollama model names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-config-"));
  try {
    await Bun.write(
      join(dir, "config.json"),
      JSON.stringify({ provider: "ollama", ollama_model: "  qwen2.5:7b  " })
    );

    const config = new ConfigManager(dir);

    expect(config.getProvider()).toBe("ollama");
    expect(config.getOllamaModel()).toBe("qwen2.5:7b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Discord provider chat escapes metadata attributes", () => {
  const message = formatDiscordUserMessage("hello", {
    chat_id: "channel&<1>",
    message_id: "message-1",
    user: 'A "quoted" user',
    user_id: "user-1",
    role: "user",
    is_dm: "false",
  });

  expect(message).toContain('chat_id="channel&amp;&lt;1&gt;"');
  expect(message).toContain('user="A &quot;quoted&quot; user"');
});

test("Discord provider chat splits long responses within message limits", () => {
  const chunks = splitDiscordContent("a".repeat(4500));

  expect(chunks).toHaveLength(3);
  expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
  expect(chunks.join("")).toBe("a".repeat(4500));
});

test("Discord provider chat caps error edits within message limits", () => {
  const message = formatProviderError(new Error("x".repeat(5000)));

  expect(message.startsWith("Chat provider error: ")).toBe(true);
  expect(message.length).toBeLessThanOrEqual(2000);
});
