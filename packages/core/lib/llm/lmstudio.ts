import type { ChatMessage, ChatProvider, ChatResponse } from "./types.ts";

// LM Studio exposes an OpenAI-compatible API at localhost:1234 by default.
const DEFAULT_BASE_URL = "http://localhost:1234/v1/chat/completions";
const DEFAULT_MODEL = "local-model";

export interface LmStudioProviderOptions {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export class LmStudioProvider implements ChatProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: LmStudioProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = opts.apiKey ?? "lm-studio";
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const content = data.choices[0]?.message.content ?? "";

    return {
      content,
      model: data.model,
      usage: data.usage
        ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}
