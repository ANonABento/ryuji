import type { ChatMessage, ChatProvider } from "./types.ts";

export const DEFAULT_OLLAMA_CHAT_ENDPOINT = "http://localhost:11434/api/chat";

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
    private readonly endpoint = DEFAULT_OLLAMA_CHAT_ENDPOINT
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
          const chunk = parseOllamaChatChunk(trimmed);
          yield* chunkContent(chunk);
          if (chunk.done) return;
        }
      }

      buffer += decoder.decode();
      const trailing = buffer.trim();
      if (trailing) {
        yield* chunkContent(parseOllamaChatChunk(trailing));
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function parseOllamaChatChunk(line: string): OllamaChatChunk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Ollama stream JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Ollama stream chunk");
  }

  const chunk = parsed as OllamaChatChunk;
  if (chunk.error) throw new Error(chunk.error);
  return chunk;
}

function* chunkContent(chunk: OllamaChatChunk): Iterable<string> {
  const content = chunk.message?.content;
  if (content) yield content;
}
