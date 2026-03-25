/**
 * Voice tools — join, leave, speak.
 */

import type { ToolDef } from "../../lib/types.ts";
import { text, err } from "../../lib/types.ts";
import { getVoiceManager } from "./index.ts";

export const voiceTools: ToolDef[] = [
  {
    definition: {
      name: "join_voice",
      description:
        "Join a Discord voice channel. The bot will listen to users and can speak via TTS.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Voice channel ID to join",
          },
          guild_id: {
            type: "string",
            description: "Server/guild ID the voice channel belongs to",
          },
        },
        required: ["channel_id", "guild_id"],
      },
    },
    handler: async (args, ctx) => {
      const manager = getVoiceManager();
      if (!manager) return err("Voice plugin not initialized");

      try {
        await manager.join(
          args.channel_id as string,
          args.guild_id as string
        );
        return text(
          `Joined voice channel ${args.channel_id}. Listening for speech.`
        );
      } catch (e: any) {
        return err(`Failed to join voice: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "leave_voice",
      description: "Leave the current voice channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          guild_id: {
            type: "string",
            description: "Server/guild ID to disconnect from",
          },
        },
        required: ["guild_id"],
      },
    },
    handler: async (args, _ctx) => {
      const manager = getVoiceManager();
      if (!manager) return err("Voice plugin not initialized");

      const disconnected = manager.leave(args.guild_id as string);
      return disconnected
        ? text("Left voice channel.")
        : err("Not connected to voice in this server.");
    },
  },
  {
    definition: {
      name: "speak",
      description:
        "Speak text in the voice channel using TTS. Supports English and Japanese.",
      inputSchema: {
        type: "object" as const,
        properties: {
          guild_id: {
            type: "string",
            description: "Server/guild ID where bot is in voice",
          },
          text: {
            type: "string",
            description: "Text to speak aloud",
          },
          language: {
            type: "string",
            enum: ["en", "ja"],
            description: "Language (default: en)",
          },
        },
        required: ["guild_id", "text"],
      },
    },
    handler: async (args, _ctx) => {
      const manager = getVoiceManager();
      if (!manager) return err("Voice plugin not initialized");

      try {
        await manager.speak(
          args.guild_id as string,
          args.text as string,
          (args.language as string) || "en"
        );
        return text("Speaking.");
      } catch (e: any) {
        return err(`TTS failed: ${e.message}`);
      }
    },
  },
];
