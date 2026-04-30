import type { ChatMessage, ChatProvider, ChatResponse } from "./types.ts";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
}

export class OllamaProvider implements ChatProvider {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: OllamaProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      message: { content: string };
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message.content,
      model: data.model,
      usage: {
        input_tokens: data.prompt_eval_count,
        output_tokens: data.eval_count,
      },
    };
  }
}
