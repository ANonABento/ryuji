import { describe, expect, test } from "bun:test";
import type { AppContext } from "../lib/types.ts";
import { getAllTools } from "../lib/tools/index.ts";
import { parseTranslateArgs, translateText } from "../lib/translation.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("translation", () => {
  const emptyAppContext = { plugins: [] } as AppContext;

  async function withMockedEnvAndFetch<T>(
    fetchImpl: typeof globalThis.fetch,
    apiKey: string | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.ANTHROPIC_API_KEY;

    globalThis.fetch = fetchImpl;
    if (apiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = apiKey;
    }

    try {
      return await run();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    }
  }

  test("parseTranslateArgs accepts target_lang and text", () => {
    expect(parseTranslateArgs({ target_lang: "Spanish", text: "Hello" })).toEqual({
      targetLang: "Spanish",
      text: "Hello",
    });
  });

  test("translateText returns Anthropic text content", async () => {
    const calls: RequestInit[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      return jsonResponse({ content: [{ type: "text", text: "Hola" }] });
    };

    const translated = await translateText(
      { targetLang: "Spanish", text: "Hello" },
      { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
    );

    expect(translated).toBe("Hola");
    expect(calls[0].headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
    const requestBody = JSON.parse(String(calls[0].body));
    expect(requestBody).toMatchObject({
      temperature: 0,
      messages: [{ role: "user" }],
    });
    expect(requestBody.messages[0].content).toContain(
      "<target_language>Spanish</target_language>"
    );
    expect(requestBody.messages[0].content).toContain(
      "<source_text>\nHello\n</source_text>"
    );
  });

  test("translateText preserves separation between multiple text blocks", async () => {
    const fetchFn = async () =>
      jsonResponse({
        content: [
          { type: "text", text: "Line one" },
          { type: "text", text: "Line two" },
        ],
      });

    const translated = await translateText(
      { targetLang: "English", text: "Uno. Dos." },
      { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
    );

    expect(translated).toBe("Line one\nLine two");
  });

  test("translateText surfaces Anthropic API errors", async () => {
    const fetchFn = async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401);

    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "bad-key", fetchFn, timeoutMs: 1000 }
      )
    ).rejects.toThrow("invalid api key");
  });

  test("translateText surfaces API failures without Anthropic error details", async () => {
    const fetchFn = async () => jsonResponse({}, 503);

    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
      )
    ).rejects.toThrow("Anthropic API request failed (503");
  });

  test("translateText requires an Anthropic API key", async () => {
    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "", fetchFn: async () => jsonResponse({}) }
      )
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
  });

  test("translateText rejects malformed successful responses", async () => {
    const fetchFn = async () =>
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });

    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
      )
    ).rejects.toThrow("Anthropic API returned no translated text.");
  });

  test("translateText rejects responses missing text content", async () => {
    const fetchFn = async () =>
      jsonResponse({ content: [{ type: "non_text", value: "ignored" }] });

    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
      )
    ).rejects.toThrow("Anthropic API returned no translated text.");
  });

  test("translateText times out slow Anthropic requests", async () => {
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "test-key", fetchFn, timeoutMs: 1 }
      )
    ).rejects.toThrow("timed out");
  });

  test("translate MCP tool is registered", () => {
    const tools = getAllTools(emptyAppContext);
    expect(tools.map((tool) => tool.definition.name)).toContain("translate");
  });

  test("translate MCP tool validates arguments and returns text", async () => {
    await withMockedEnvAndFetch(
      (async () =>
        jsonResponse({ content: [{ type: "text", text: "Hola" }] })) as typeof globalThis.fetch,
      "test-key",
      async () => {
        const translateTool = getAllTools(emptyAppContext).find(
          (tool) => tool.definition.name === "translate"
        );
        expect(translateTool).toBeDefined();

        const missingText = await translateTool!.handler(
          { target_lang: "Spanish" },
          emptyAppContext
        );
        expect(missingText.isError).toBe(true);
        expect(missingText.content[0].text).toContain("text is required");

        const result = await translateTool!.handler(
          { target_lang: "Spanish", text: "Hello" },
          emptyAppContext
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toBe("Hola");
      }
    );
  });

  test("fetchFn accepts RequestInfo", async () => {
    const fetchFn = async (_url: RequestInfo) =>
      Promise.resolve(
        jsonResponse({ content: [{ type: "text", text: "Hola" }] })
      );
    const translated = await translateText(
      { targetLang: "Spanish", text: "Hello" },
      { apiKey: "test-key", fetchFn, timeoutMs: 1000 }
    );
    expect(translated).toBe("Hola");
  });
});
