import { describe, expect, test } from "bun:test";
import { getAllTools } from "../lib/tools/index.ts";
import { parseTranslateArgs, translateText } from "../lib/translation.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("translation", () => {
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
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      temperature: 0,
      messages: [{ role: "user" }],
    });
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

  test("translateText requires an Anthropic API key", async () => {
    await expect(
      translateText(
        { targetLang: "Spanish", text: "Hello" },
        { apiKey: "", fetchFn: async () => jsonResponse({}) }
      )
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
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
    const tools = getAllTools({ plugins: [] } as any);
    expect(tools.map((tool) => tool.definition.name)).toContain("translate");
  });

  test("translate MCP tool validates arguments and returns text", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = (async () =>
      jsonResponse({ content: [{ type: "text", text: "Hola" }] })) as unknown as typeof fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";

    try {
      const translateTool = getAllTools({ plugins: [] } as any).find(
        (tool) => tool.definition.name === "translate"
      );
      expect(translateTool).toBeDefined();

      const missingText = await translateTool!.handler({ target_lang: "Spanish" }, {} as any);
      expect(missingText.isError).toBe(true);
      expect(missingText.content[0].text).toContain("text is required");

      const result = await translateTool!.handler(
        { target_lang: "Spanish", text: "Hello" },
        {} as any
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("Hola");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalApiKey;
      }
    }
  });
});
