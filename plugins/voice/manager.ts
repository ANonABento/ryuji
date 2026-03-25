/**
 * VoiceManager — handles voice connections, audio receive/playback, STT + TTS.
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import type { AppContext } from "../../lib/types.ts";
import { transcribe } from "./stt.ts";
import { synthesize } from "./tts.ts";

interface GuildVoice {
  connection: VoiceConnection;
  player: AudioPlayer;
  listeningTo: Set<string>; // user IDs we're subscribed to
}

export class VoiceManager {
  private guilds = new Map<string, GuildVoice>();
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async join(channelId: string, guildId: string) {
    // Disconnect existing connection in this guild
    this.leave(guildId);

    const guild = await this.ctx.discord.guilds.fetch(guildId);

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false, // Need to receive audio
      selfMute: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const guildVoice: GuildVoice = {
      connection,
      player,
      listeningTo: new Set(),
    };
    this.guilds.set(guildId, guildVoice);

    // Listen for users speaking
    connection.receiver.speaking.on("start", (userId: string) => {
      if (guildVoice.listeningTo.has(userId)) return;
      this.listenToUser(guildId, userId);
    });

    console.error(`Voice: joined channel ${channelId} in guild ${guildId}`);
  }

  leave(guildId: string): boolean {
    const gv = this.guilds.get(guildId);
    if (!gv) return false;

    gv.connection.destroy();
    gv.player.stop();
    this.guilds.delete(guildId);
    console.error(`Voice: left guild ${guildId}`);
    return true;
  }

  disconnectAll() {
    for (const [guildId] of this.guilds) {
      this.leave(guildId);
    }
  }

  async speak(guildId: string, text: string, language: string = "en") {
    const gv = this.guilds.get(guildId);
    if (!gv) throw new Error("Not connected to voice in this server");

    // Get audio from ElevenLabs
    const audioBuffer = await synthesize(text, language);

    // Create a readable stream from the buffer
    const stream = Readable.from(audioBuffer);
    const resource = createAudioResource(stream);

    // Wait for any current playback to finish
    if (gv.player.state.status === AudioPlayerStatus.Playing) {
      await entersState(gv.player, AudioPlayerStatus.Idle, 30_000);
    }

    gv.player.play(resource);
    await entersState(gv.player, AudioPlayerStatus.Playing, 5_000);
  }

  private listenToUser(guildId: string, userId: string) {
    const gv = this.guilds.get(guildId);
    if (!gv) return;

    // Don't listen to ourselves
    if (userId === this.ctx.discord.user?.id) return;

    gv.listeningTo.add(userId);

    const opusStream = gv.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000, // 1 second of silence = end of speech
      },
    });

    const chunks: Buffer[] = [];

    opusStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    opusStream.on("end", async () => {
      gv.listeningTo.delete(userId);

      // Need at least some data to transcribe (skip very short utterances)
      if (chunks.length < 10) return;

      try {
        // Convert Opus chunks to PCM WAV for Groq
        const pcmBuffer = await this.opusToPcm(chunks);
        if (pcmBuffer.length < 4800) return; // Skip if too short (~50ms)

        // Transcribe with Groq
        const transcript = await transcribe(pcmBuffer);
        if (!transcript || transcript.trim().length === 0) return;

        console.error(
          `Voice STT [${userId}]: ${transcript}`
        );

        // Forward to Claude as a voice message
        const user = await this.ctx.discord.users.fetch(userId);
        const guildVoice = this.guilds.get(guildId);
        const channelId = guildVoice?.connection.joinConfig.channelId;

        this.ctx.mcp.notification({
          method: "notifications/claude/channel",
          params: {
            content: transcript,
            meta: {
              chat_id: channelId || guildId,
              message_id: `voice_${Date.now()}`,
              user: user.username,
              user_id: userId,
              ts: new Date().toISOString(),
              is_dm: "false",
              role:
                this.ctx.ownerUserId && userId === this.ctx.ownerUserId
                  ? "owner"
                  : "user",
              source: "voice",
              guild_id: guildId,
            },
          },
        });
      } catch (e) {
        console.error(`Voice STT error: ${e}`);
      }
    });
  }

  private async opusToPcm(opusChunks: Buffer[]): Promise<Buffer> {
    // Use ffmpeg to decode Opus to PCM WAV
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-f", "opus",
        "-i", "pipe:0",
        "-f", "wav",
        "-ar", "16000", // 16kHz for Whisper
        "-ac", "1", // Mono
        "-acodec", "pcm_s16le",
        "pipe:1",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    // Write Opus data to ffmpeg stdin
    const writer = proc.stdin.getWriter();
    for (const chunk of opusChunks) {
      await writer.write(chunk);
    }
    await writer.close();

    // Read PCM output
    const output = await new Response(proc.stdout).arrayBuffer();
    await proc.exited;

    return Buffer.from(output);
  }
}
