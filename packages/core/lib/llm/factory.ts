import type { LlmConfig } from "../config.ts";
import type { ChatProvider } from "./types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { LmStudioProvider } from "./lmstudio.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAIProvider } from "./openai.ts";

export function createChatProvider(cfg: LlmConfig): ChatProvider {
  const { provider, model, apiKey, baseUrl } = cfg;

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider({ model, apiKey, baseUrl });
    case "openai":
      return new OpenAIProvider({ model, apiKey, baseUrl });
    case "ollama":
      return new OllamaProvider({ model, baseUrl });
    case "lmstudio":
      return new LmStudioProvider({ model, apiKey, baseUrl });
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export type { ChatProvider } from "./types.ts";
export type { ChatMessage, ChatResponse } from "./types.ts";
