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

  test("translate MCP tool is registered", () => {
    const tools = getAllTools({ plugins: [] } as any);
    expect(tools.map((tool) => tool.definition.name)).toContain("translate");
  });
});
