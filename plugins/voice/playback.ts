import {
  AudioPlayerStatus,
  createAudioResource,
  entersState,
  StreamType,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import type { TTSProvider } from "./providers/index.ts";
import { splitSentences } from "./sentence-splitter.ts";
import type { GuildVoice } from "./types.ts";

export async function speakText(
  gv: GuildVoice,
  text: string,
  language: string,
  speed: number,
  tts: TTSProvider,
  generationId: number,
  opts: {
    playbackFinishTimeout: number;
    playbackStartTimeout: number;
  },
): Promise<void> {
  const sentences = splitSentences(text);

  gv.lastSpokenText = "";

  if (sentences.length <= 1) {
    const chunk = sentences[0] ?? text;
    await playSingleChunk(gv, chunk, language, speed, tts, opts);
    if (gv.generationId === generationId) {
      gv.lastSpokenText = chunk;
    }
    return;
  }

  console.error(`Voice: streaming ${sentences.length} sentence chunks`);

  let nextPcm: Promise<Buffer | null> = synthesizeSafe(sentences[0], language, speed, tts);

  for (let i = 0; i < sentences.length; i++) {
    if (gv.generationId !== generationId) {
      console.error(
        `Voice: generation ${generationId} invalidated, stopping at chunk ${i + 1}/${sentences.length}`,
      );
      return;
    }

    const pcm = await nextPcm;

    if (i + 1 < sentences.length) {
      nextPcm = synthesizeSafe(sentences[i + 1], language, speed, tts);
    }

    if (!pcm) {
      console.error(`Voice: skipping chunk ${i + 1}/${sentences.length} (synthesis failed)`);
      continue;
    }

    if (gv.generationId !== generationId) {
      console.error(`Voice: generation ${generationId} invalidated during synthesis`);
      return;
    }

    await playPcmBuffer(gv, pcm, opts);
    gv.lastSpokenText += (gv.lastSpokenText ? " " : "") + sentences[i];
  }
}

async function synthesizeSafe(
  text: string,
  language: string,
  speed: number,
  tts: TTSProvider,
): Promise<Buffer | null> {
  try {
    return await tts.synthesize(text, language, speed);
  } catch (e) {
    console.error(`Voice TTS error: ${e}`);
    return null;
  }
}

async function playSingleChunk(
  gv: GuildVoice,
  text: string,
  language: string,
  speed: number,
  tts: TTSProvider,
  opts: {
    playbackFinishTimeout: number;
    playbackStartTimeout: number;
  },
): Promise<void> {
  const audioBuffer = await tts.synthesize(text, language, speed);
  await playPcmBuffer(gv, audioBuffer, opts);
}

async function playPcmBuffer(
  gv: GuildVoice,
  pcm: Buffer,
  opts: {
    playbackFinishTimeout: number;
    playbackStartTimeout: number;
  },
): Promise<void> {
  const stream = Readable.from(pcm);
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw,
  });

  if (gv.player.state.status === AudioPlayerStatus.Playing) {
    await entersState(gv.player, AudioPlayerStatus.Idle, opts.playbackFinishTimeout);
  }

  gv.player.play(resource);
  await entersState(gv.player, AudioPlayerStatus.Playing, opts.playbackStartTimeout);
  await entersState(gv.player, AudioPlayerStatus.Idle, opts.playbackFinishTimeout);
}
