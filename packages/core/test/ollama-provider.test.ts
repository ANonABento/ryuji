import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../lib/config.ts";
import { OllamaProvider } from "../lib/chat/ollama-provider.ts";

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
