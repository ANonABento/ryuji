import type { ChatMessage, ChatResponse } from "./types.ts";

interface OpenAICompatResponse {
  choices: Array<{ message: { content: string } }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export async function fetchOpenAICompat(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  errorLabel: string,
): Promise<ChatResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${errorLabel} error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as OpenAICompatResponse;
  return {
    content: data.choices[0]?.message.content ?? "",
    model: data.model,
    usage: data.usage
      ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
      : undefined,
  };
}
