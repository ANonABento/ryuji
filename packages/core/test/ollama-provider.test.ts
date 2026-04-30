import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../lib/config.ts";
import { OllamaProvider } from "../lib/chat/ollama-provider.ts";
import {
  formatProviderError,
  splitDiscordContent,
} from "../lib/chat/discord-chat.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("OllamaProvider maps chat messages and streams response chunks", async () => {
  const body = [
    JSON.stringify({ message: { role: "assistant", content: "hel" }, done: false }),
    JSON.stringify({ message: { role: "assistant", content: "lo" }, done: true }),
  ].join("\n");

  let requestBody: any;
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(init?.body as string);
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const provider = new OllamaProvider("llama3.1:8b");
  let result = "";
  for await (const chunk of provider.stream([
    { role: "system", content: "Be concise." },
    { role: "user", content: "Say hello." },
  ])) {
    result += chunk;
  }

  expect(requestBody).toEqual({
    model: "llama3.1:8b",
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

  const provider = new OllamaProvider("llama3.1:8b");
  let result = "";
  for await (const chunk of provider.stream([
    { role: "user", content: "Say hi." },
  ])) {
    result += chunk;
  }

  expect(result).toBe("hi \u2603");
});

test("ConfigManager defaults Ollama model while preserving Claude provider default", async () => {
  const dir = join(tmpdir(), `choomfie-config-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  try {
    const config = new ConfigManager(dir);
    expect(config.getProvider()).toBe("claude");
    expect(config.getOllamaModel()).toBe("llama3.1:8b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Discord provider chat splits long responses within message limits", () => {
  const chunks = splitDiscordContent("a".repeat(4500));

  expect(chunks).toHaveLength(3);
  expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
  expect(chunks.join("")).toBe("a".repeat(4500));
});

test("Discord provider chat caps error edits within message limits", () => {
  const message = formatProviderError(new Error("x".repeat(5000)));

  expect(message.startsWith("Ollama error: ")).toBe(true);
  expect(message.length).toBeLessThanOrEqual(2000);
});
