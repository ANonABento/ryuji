export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatProvider {
  name: string;
  stream(messages: ChatMessage[]): AsyncIterable<string>;
}
