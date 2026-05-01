import type { ChatMessage, ChatProvider, ChatResponse } from "./types.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class AnthropicProvider implements ChatProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? ANTHROPIC_API_URL;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === "system")?.content;
    const filtered = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: filtered.map((m) => ({ role: m.role, content: m.content })),
    };
    if (system) body.system = system;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const content = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      content,
      model: data.model,
      usage: data.usage
        ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens }
        : undefined,
    };
  }
}
