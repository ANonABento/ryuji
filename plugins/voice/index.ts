/**
 * Voice plugin — Discord voice channel support.
 *
 * Providers (auto-detected or configurable):
 *   STT: whisper (local), groq (free API), elevenlabs (paid)
 *   TTS: kokoro (local), edge-tts (free), elevenlabs (paid)
 *
 * Flow: User speaks → Opus → PCM → WAV → STT → Claude → TTS → Opus → Discord
 */

import { GatewayIntentBits } from "discord.js";
import type { Plugin } from "@choomfie/shared";
import { voiceTools } from "./tools.ts";
import { VoiceManager } from "./manager.ts";

let manager: VoiceManager | null = null;

const voicePlugin: Plugin = {
  name: "voice",

  tools: voiceTools,

  intents: [GatewayIntentBits.GuildVoiceStates],

  instructions: [
    "## Voice",
    "You can join Discord voice channels and have voice conversations.",
    "Use `join_voice` with a channel ID to join. Use `leave_voice` to disconnect.",
    "Use `speak` to say something in the voice channel (TTS).",
    "When users speak in VC, their speech is automatically transcribed (STT) and sent to you.",
    "You can respond by using the `speak` tool — your response will be spoken aloud.",
    "STT/TTS providers are auto-detected or configurable in config.json.",
    "",
    "## Voice Response Style",
    "When responding to voice messages (source='voice'), follow these rules:",
    "- Keep responses concise — 1-3 sentences for simple questions, 4-5 for complex ones.",
    "- Use natural speech patterns: contractions, varied sentence length, conversational flow.",
    "- NEVER use markdown, bullet lists, code blocks, headers, or numbered lists — they sound terrible when spoken.",
    "- NEVER use URLs, file paths, or long technical notation in voice responses.",
    "- If asked for complex information (code, long lists, tables), give a brief spoken summary and offer to send details in text via the reply tool.",
    "- Use conversational transitions: 'So basically...', 'The thing is...', 'Oh and also...'",
    "- Do not narrate what you're about to do — just speak the result.",
  ],

  userTools: ["join_voice", "leave_voice", "speak"],

  async init(ctx) {
    manager = new VoiceManager(ctx);
    await manager.init();
    // Make manager accessible to tools via a module-level ref
    setVoiceManager(manager);
    console.error("Voice plugin initialized");
  },

  async destroy() {
    if (manager) {
      manager.disconnectAll();
      manager = null;
    }
  },
};

// Module-level accessor for tools to use
let _manager: VoiceManager | null = null;
export function setVoiceManager(m: VoiceManager | null) {
  _manager = m;
}
export function getVoiceManager(): VoiceManager | null {
  return _manager;
}

export default voicePlugin;
