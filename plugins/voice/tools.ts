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
        "Join a Discord voice channel. Can auto-detect: if user_id is provided, joins the VC the user is in. " +
        "If text_channel_id is provided, finds the first VC in that server. " +
        "Or provide channel_id + guild_id directly.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Voice channel ID to join (optional if user_id or text_channel_id provided)",
          },
          guild_id: {
            type: "string",
            description: "Server/guild ID (optional, auto-resolved from channel or user)",
          },
          user_id: {
            type: "string",
            description: "User ID — joins whatever VC this user is currently in (optional)",
          },
          text_channel_id: {
            type: "string",
            description: "Text channel ID — resolves the guild and finds a VC to join (optional)",
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const manager = getVoiceManager();
      if (!manager) return err("Voice plugin not initialized");

      try {
        let channelId = args.channel_id as string | undefined;
        let guildId = args.guild_id as string | undefined;

        // Auto-resolve from text channel
        if (!channelId && args.text_channel_id) {
          const textChannel = await ctx.discord.channels.fetch(args.text_channel_id as string).catch(() => null);
          if (!textChannel || !("guild" in textChannel) || !textChannel.guild) {
            return err("Couldn't find that channel or it's not in a server.");
          }
          guildId = textChannel.guild.id;

          // If user_id provided, find their VC in this guild
          if (args.user_id) {
            const member = await textChannel.guild.members.fetch(args.user_id as string).catch(() => null);
            if (member?.voice?.channelId) {
              channelId = member.voice.channelId;
            }
          }

          // Fallback: find first populated VC, or first VC in guild
          if (!channelId) {
            const channels = textChannel.guild.channels.cache
              .filter((c: any) => c.type === 2) // GuildVoice
              .sort((a: any, b: any) => (b.members?.size || 0) - (a.members?.size || 0));
            const vc = channels.first();
            if (vc) {
              channelId = vc.id;
            } else {
              return err("No voice channels found in this server.");
            }
          }
        }

        // Auto-resolve from user_id only (search all guilds)
        if (!channelId && args.user_id && !args.text_channel_id) {
          for (const [, guild] of ctx.discord.guilds.cache) {
            const member = await guild.members.fetch(args.user_id as string).catch(() => null);
            if (member?.voice?.channelId) {
              channelId = member.voice.channelId;
              guildId = guild.id;
              break;
            }
          }
          if (!channelId) {
            return err("User isn't in a voice channel.");
          }
        }

        if (!channelId || !guildId) {
          return err("Provide channel_id + guild_id, or user_id, or text_channel_id to auto-detect.");
        }

        await manager.join(channelId, guildId);
        return text(`Joined voice channel ${channelId}. Listening for speech.`);
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
