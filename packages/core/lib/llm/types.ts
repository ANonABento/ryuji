export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResponse {
  content: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface ChatProvider {
  chat(messages: ChatMessage[]): Promise<ChatResponse>;
}
