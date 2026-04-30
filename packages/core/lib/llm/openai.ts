import type { ChatMessage, ChatProvider, ChatResponse } from "./types.ts";
import { fetchOpenAICompat } from "./openai-compat.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements ChatProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = opts.baseUrl ?? OPENAI_API_URL;
  }

  chat(messages: ChatMessage[]): Promise<ChatResponse> {
    return fetchOpenAICompat(this.baseUrl, this.apiKey, this.model, messages, "OpenAI API");
  }
}
