const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TRANSLATION_MODEL = "claude-3-5-haiku-latest";
const TRANSLATION_TIMEOUT_MS = 4500;

export interface TranslateInput {
  targetLang: string;
  text: string;
}

export interface TranslateOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicErrorResponse {
  error?: {
    type?: string;
    message?: string;
  };
}

interface AnthropicMessageResponse {
  content?: Array<AnthropicTextBlock | { type: string; [key: string]: unknown }>;
}

function stringArg(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseTranslateArgs(args: Record<string, unknown>): TranslateInput | string {
  const targetLang = stringArg(args.target_lang ?? args.targetLang);
  if (!targetLang) return "target_lang is required.";

  const text = stringArg(args.text);
  if (!text) return "text is required.";

  return { targetLang, text };
}

function getAnthropicErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as AnthropicErrorResponse).error;
  if (!error) return null;
  return error.message || error.type || null;
}

function extractTranslation(body: AnthropicMessageResponse): string | null {
  const textBlocks = body.content?.filter(
    (block): block is AnthropicTextBlock =>
      block.type === "text" && typeof (block as AnthropicTextBlock).text === "string"
  );
  const translated = textBlocks?.map((block) => block.text).join("").trim();
  return translated || null;
}

export async function translateText(
  input: TranslateInput,
  options: TranslateOptions = {}
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TRANSLATION_TIMEOUT_MS
  );

  try {
    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:
          options.model ??
          process.env.ANTHROPIC_TRANSLATE_MODEL ??
          DEFAULT_TRANSLATION_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system:
          "You translate text. Detect the source language automatically. Return only the translated text, with no commentary, labels, code fences, or notes.",
        messages: [
          {
            role: "user",
            content: `Translate the following text to ${input.targetLang}:\n\n${input.text}`,
          },
        ],
      }),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Keep body null; status handling below will report the HTTP failure.
    }

    if (!response.ok) {
      const detail = getAnthropicErrorMessage(body);
      throw new Error(
        `Anthropic API request failed (${response.status})${detail ? `: ${detail}` : "."}`
      );
    }

    const translated = extractTranslation(body as AnthropicMessageResponse);
    if (!translated) {
      throw new Error("Anthropic API returned no translated text.");
    }

    return translated;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Anthropic API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
