/**
 * Speech-to-Text — Groq Whisper API.
 *
 * Free tier: 30 req/min, 14,400 req/day, 25MB per request.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribe(
  pcmWavBuffer: Buffer,
  language?: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY not set. Add it to ~/.claude/channels/choomfie/.env"
    );
  }

  // Build multipart form data
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([pcmWavBuffer], { type: "audio/wav" }),
    "audio.wav"
  );
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  // Auto-detect or specify language
  if (language) {
    formData.append("language", language);
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq STT error (${response.status}): ${body}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text;
}
