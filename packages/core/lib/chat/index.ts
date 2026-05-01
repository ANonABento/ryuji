import { OllamaProvider } from "./ollama-provider.ts";
import type { ChatProvider } from "./types.ts";
import type { ConfigManager } from "../config.ts";

export type { ChatMessage, ChatProvider } from "./types.ts";
export { OllamaProvider } from "./ollama-provider.ts";

export function createChatProvider(config: ConfigManager): ChatProvider | null {
  if (config.getProvider() !== "ollama") return null;
  return new OllamaProvider(config.getOllamaModel());
}
