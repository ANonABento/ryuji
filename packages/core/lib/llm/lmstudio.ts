import type { ChatMessage, ChatProvider, ChatResponse } from "./types.ts";
import { fetchOpenAICompat } from "./openai-compat.ts";

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

  chat(messages: ChatMessage[]): Promise<ChatResponse> {
    return fetchOpenAICompat(this.baseUrl, this.apiKey, this.model, messages, "LM Studio API");
  }
}
