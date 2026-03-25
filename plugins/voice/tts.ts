/**
 * Text-to-Speech — ElevenLabs API.
 *
 * Uses streaming endpoint for low latency.
 * Returns PCM audio buffer that can be played via @discordjs/voice.
 */

// Default voices — can be overridden via env vars
const DEFAULT_VOICE_EN = "21m00Tcm4TlvDq8ikWAM"; // Rachel (English)
const DEFAULT_VOICE_JA = "21m00Tcm4TlvDq8ikWAM"; // Same voice, multilingual model handles JP

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export async function synthesize(
  text: string,
  language: string = "en"
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY not set. Add it to ~/.claude/channels/choomfie/.env"
    );
  }

  const voiceId =
    language === "ja"
      ? process.env.ELEVENLABS_VOICE_JA || DEFAULT_VOICE_JA
      : process.env.ELEVENLABS_VOICE_EN || DEFAULT_VOICE_EN;

  const response = await fetch(
    `${ELEVENLABS_API_URL}/${voiceId}/stream?output_format=pcm_48000`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        language_code: language,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS error (${response.status}): ${body}`);
  }

  // Collect the streamed PCM audio
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
