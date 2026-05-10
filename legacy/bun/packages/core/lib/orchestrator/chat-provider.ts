/**
 * ChatProvider — abstraction over local LLM backends.
 *
 * The OllamaProvider talks to a local Ollama daemon via its REST API.
 * The HermesProvider talks to a local Hermes API server using its
 * OpenAI-compatible surface.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Backend-specific conversation/session continuity hint */
  sessionId?: string;
  /** Backend-specific long-term memory/user scope hint */
  sessionKey?: string;
  /** Stop generation early when these strings appear */
  stop?: string[];
  /** 0.0-2.0, default 0.7 */
  temperature?: number;
  /** Max tokens to generate */
  numPredict?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  /** Tokens-per-second for the generation phase, when reported */
  tps: number | null;
  /** Total ms from request start to first token */
  firstTokenMs: number | null;
  /** Total ms from request start to completion */
  totalMs: number;
  model: string;
}

export interface ModelInfo {
  name: string;
  /** Bytes on disk */
  size: number;
  /** SHA-256 digest from Ollama */
  digest: string;
  /** Approximate parameter count (e.g. "7B", "32B") if parseable */
  paramSize?: string;
  /** Quantization label if reported (e.g. "Q4_0") */
  quant?: string;
  /** Family label (llama, qwen, mistral, codestral, deepseek, ...) */
  family?: string;
  /** Modified timestamp ISO string */
  modifiedAt?: string;
}

export interface ChatProvider {
  readonly kind: "ollama" | "hermes" | "stub";
  /** List models available locally. */
  listModels(): Promise<ModelInfo[]>;
  /** Run a chat completion (non-streaming). */
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Stream chat completions; yields incremental chunks. */
  chatStream(req: ChatRequest): AsyncGenerator<string, ChatResponse>;
  /** Pre-warm a model so the first user request isn't cold. */
  prewarm(model: string): Promise<void>;
  /** Whether the backend is reachable. */
  ping(): Promise<boolean>;
}

interface OpenAIModelListResponse {
  data?: Array<{
    id?: string;
    object?: string;
    created?: number;
    owned_by?: string;
  }>;
}

interface OpenAIChatChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at?: string;
    size: number;
    digest: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface OllamaChatChunk {
  model: string;
  done: boolean;
  message?: { role: string; content: string };
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

const NS_PER_SEC = 1_000_000_000;

export class OllamaProvider implements ChatProvider {
  readonly kind = "ollama" as const;

  constructor(private baseUrl: string = "http://localhost:11434") {
    // Strip trailing slash + any /v1 suffix; we use the native API directly.
    this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`ollama list failed: ${res.status}`);
    const data = (await res.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      paramSize: m.details?.parameter_size,
      quant: m.details?.quantization_level,
      family: m.details?.family,
      modifiedAt: m.modified_at,
    }));
  }

  async prewarm(model: string): Promise<void> {
    // Empty prompt loads weights into memory without generating tokens.
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: "10m" }),
    });
    if (!res.ok) throw new Error(`ollama prewarm failed: ${res.status}`);
    // Drain body so the connection closes cleanly
    await res.text().catch(() => {});
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let text = "";
    const stream = this.chatStream(req);
    let result = await stream.next();
    while (!result.done) {
      text += result.value as string;
      result = await stream.next();
    }
    const last = result.value as ChatResponse;
    return { ...last, text };
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const start = performance.now();
    let firstTokenMs: number | null = null;

    const body = {
      model: req.model,
      messages: req.messages,
      stream: true,
      options: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.numPredict !== undefined ? { num_predict: req.numPredict } : {}),
        ...(req.stop && req.stop.length > 0 ? { stop: req.stop } : {}),
      },
      keep_alive: "10m",
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`ollama chat failed: ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalChunk: OllamaChatChunk | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line) as OllamaChatChunk;
          } catch {
            continue;
          }
          const piece = chunk.message?.content ?? "";
          if (piece) {
            if (firstTokenMs === null) firstTokenMs = performance.now() - start;
            yield piece;
          }
          if (chunk.done) finalChunk = chunk;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }

    const totalMs = performance.now() - start;
    let tps: number | null = null;
    if (finalChunk?.eval_count && finalChunk?.eval_duration) {
      tps = finalChunk.eval_count / (finalChunk.eval_duration / NS_PER_SEC);
    }

    return {
      text: "",
      tps,
      firstTokenMs,
      totalMs,
      model: finalChunk?.model ?? req.model,
    };
  }
}

export interface HermesProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * HermesProvider talks to a running Hermes Agent API server.
 *
 * Hermes exposes an OpenAI-compatible endpoint (usually
 * http://127.0.0.1:8642/v1). The requested model name is cosmetic on the
 * Hermes side, but keeping it here lets Choomfie route through the existing
 * local runtime without owning Hermes' internal provider selection.
 */
export class HermesProvider implements ChatProvider {
  readonly kind = "hermes" as const;

  private baseUrl: string;
  private apiKey: string | null;
  private model: string;

  constructor(options: HermesProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8642/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey?.trim() || null;
    this.model = options.model?.trim() || "hermes-agent";
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`hermes list failed: ${res.status}`);
    const data = (await res.json()) as OpenAIModelListResponse;
    const models = data.data ?? [];
    if (models.length === 0) {
      return [{ name: this.model, size: 0, digest: "hermes-api", family: "hermes" }];
    }
    return models.map((m) => ({
      name: m.id || this.model,
      size: 0,
      digest: `hermes-api:${m.id || this.model}`,
      family: "hermes",
      modifiedAt: m.created ? new Date(m.created * 1000).toISOString() : undefined,
    }));
  }

  async prewarm(_model: string): Promise<void> {
    // Hermes owns its own provider/model warmup. A no-op keeps LocalRuntime
    // startup cheap and avoids spending tokens on a synthetic prompt.
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const start = performance.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.headers(req),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: req.model || this.model,
        messages: req.messages,
        stream: false,
        temperature: req.temperature,
        max_tokens: req.numPredict,
        stop: req.stop,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new Error(`hermes chat failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "";
    return {
      text,
      tps: null,
      firstTokenMs: null,
      totalMs: performance.now() - start,
      model: data.model ?? req.model ?? this.model,
    };
  }

  async *chatStream(req: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const start = performance.now();
    let firstTokenMs: number | null = null;
    let finalModel = req.model || this.model;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.headers(req),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: finalModel,
        messages: req.messages,
        stream: true,
        temperature: req.temperature,
        max_tokens: req.numPredict,
        stop: req.stop,
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`hermes chat failed: ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          let chunk: OpenAIChatChunk;
          try {
            chunk = JSON.parse(payload) as OpenAIChatChunk;
          } catch {
            continue;
          }
          if (chunk.model) finalModel = chunk.model;
          const piece = chunk.choices?.[0]?.delta?.content ?? "";
          if (piece) {
            if (firstTokenMs === null) firstTokenMs = performance.now() - start;
            yield piece;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }

    return {
      text: "",
      tps: null,
      firstTokenMs,
      totalMs: performance.now() - start,
      model: finalModel,
    };
  }

  private headers(req?: Pick<ChatRequest, "sessionId" | "sessionKey">): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
      if (req?.sessionId) headers["X-Hermes-Session-Id"] = req.sessionId;
      if (req?.sessionKey) headers["X-Hermes-Session-Key"] = req.sessionKey;
    }
    return headers;
  }
}
