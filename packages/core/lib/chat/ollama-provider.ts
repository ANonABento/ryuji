import type { ChatMessage, ChatProvider } from "./types.ts";

interface OllamaChatChunk {
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements ChatProvider {
  readonly name = "ollama";

  constructor(
    private readonly model: string,
    private readonly endpoint = "http://localhost:11434/api/chat"
  ) {}

  async *stream(messages: ChatMessage[]): AsyncIterable<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Ollama chat failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
    }

    if (!response.body) {
      throw new Error("Ollama chat response did not include a stream body");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          if (chunk.error) throw new Error(chunk.error);
          const content = chunk.message?.content;
          if (content) yield content;
          if (chunk.done) return;
        }
      }

      const trailing = buffer.trim();
      if (trailing) {
        const chunk = JSON.parse(trailing) as OllamaChatChunk;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) yield chunk.message.content;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
