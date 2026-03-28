/**
 * Silero VAD wrapper + adaptive speech endpointing.
 *
 * Uses the Silero ONNX model (bundled with @ricky0123/vad-node) for
 * frame-by-frame voice activity detection. The SpeechDetector class
 * tracks speech state and uses adaptive silence thresholds:
 *
 *   threshold = min(maxSilenceMs, minSilenceMs + utteranceDuration * adaptiveFactor)
 *
 * Short utterances ("yes") → ~400ms silence to end
 * Long utterances (full sentence) → up to ~1200ms pause tolerance
 */

import * as ort from "onnxruntime-node";
import { resolve, dirname } from "node:path";

// --- VAD config ---

interface VADConfig {
  /** Minimum silence after speech to consider end-of-utterance (ms) */
  minSilenceMs: number;
  /** Adaptive factor: threshold grows with utterance duration */
  adaptiveFactor: number;
  /** Maximum silence threshold (ms) */
  maxSilenceMs: number;
  /** Speech probability threshold (0-1) */
  speechThreshold: number;
}

const DEFAULT_VAD_CONFIG: VADConfig = {
  minSilenceMs: 400,
  adaptiveFactor: 0.3,
  maxSilenceMs: 1200,
  speechThreshold: 0.5,
};

// --- Silero ONNX wrapper ---

/** Frame-by-frame Silero VAD using ONNX Runtime directly */
export class SileroVAD {
  private session!: ort.InferenceSession;
  private h!: ort.Tensor;
  private c!: ort.Tensor;
  private sr: ort.Tensor;

  /** Silero expects 512 samples at 16kHz (32ms per frame) */
  static readonly FRAME_SIZE = 512;
  static readonly SAMPLE_RATE = 16000;

  private constructor() {
    this.sr = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(SileroVAD.SAMPLE_RATE)]),
      [1]
    );
  }

  static async create(): Promise<SileroVAD> {
    const vad = new SileroVAD();

    // Model is bundled with @ricky0123/vad-node
    const vadNodeEntry = require.resolve("@ricky0123/vad-node");
    const modelPath = resolve(dirname(vadNodeEntry), "silero_vad.onnx");

    vad.session = await ort.InferenceSession.create(modelPath);
    vad.resetState();

    return vad;
  }

  /** Reset hidden state (call between utterances / users) */
  resetState() {
    this.h = new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [
      2, 1, 64,
    ]);
    this.c = new ort.Tensor("float32", new Float32Array(2 * 1 * 64), [
      2, 1, 64,
    ]);
  }

  /**
   * Process a single frame and return speech probability (0-1).
   * @param frame - Float32Array of exactly FRAME_SIZE (512) samples, 16kHz mono
   */
  async process(frame: Float32Array): Promise<number> {
    if (frame.length !== SileroVAD.FRAME_SIZE) {
      throw new Error(
        `Expected ${SileroVAD.FRAME_SIZE} samples, got ${frame.length}`
      );
    }

    const input = new ort.Tensor("float32", frame, [1, SileroVAD.FRAME_SIZE]);
    const result = await this.session.run({
      input,
      sr: this.sr,
      h: this.h,
      c: this.c,
    });

    // Update hidden state for next frame
    this.h = result.hn as ort.Tensor;
    this.c = result.cn as ort.Tensor;

    return (result.output as ort.Tensor).data[0] as number;
  }
}

// --- Adaptive speech detector ---

export type SpeechEvent = "speech_start" | "speech_end";

export class SpeechDetector {
  private speechStartTime: number | null = null;
  private lastSpeechTime = 0;
  private isSpeaking = false;
  private config: VADConfig;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  /**
   * Feed a speech probability value from Silero VAD.
   * Returns 'speech_start', 'speech_end', or null.
   */
  processProbability(
    probability: number,
    now: number = Date.now()
  ): SpeechEvent | null {
    const isSpeech = probability > this.config.speechThreshold;

    if (isSpeech && !this.isSpeaking) {
      this.isSpeaking = true;
      this.speechStartTime = now;
      this.lastSpeechTime = now;
      return "speech_start";
    }

    if (isSpeech) {
      this.lastSpeechTime = now;
      return null;
    }

    // Not speech — check if we should end
    if (this.isSpeaking) {
      const speechDuration = now - (this.speechStartTime ?? now);
      const silenceDuration = now - this.lastSpeechTime;

      // Adaptive threshold: short utterances get shorter silence before cut
      const threshold = Math.min(
        this.config.maxSilenceMs,
        this.config.minSilenceMs + speechDuration * this.config.adaptiveFactor
      );

      if (silenceDuration >= threshold) {
        this.isSpeaking = false;
        this.speechStartTime = null;
        return "speech_end";
      }
    }

    return null;
  }

  /** Reset state (between utterances) */
  reset() {
    this.isSpeaking = false;
    this.speechStartTime = null;
    this.lastSpeechTime = 0;
  }

  /** Whether the detector thinks someone is currently speaking */
  get speaking(): boolean {
    return this.isSpeaking;
  }
}

// --- Audio helpers ---

/**
 * Downsample 48kHz stereo s16le PCM to 16kHz mono Float32 for Silero VAD.
 *
 * Simple 3:1 decimation with channel averaging. Not audiophile quality,
 * but adequate for voice activity detection.
 */
export function downsampleForVAD(pcm48kStereo: Buffer): Float32Array {
  // Input: s16le, 48kHz, stereo → 4 bytes per sample-pair (2 channels * 2 bytes)
  const bytesPerSamplePair = 4; // stereo s16le
  const totalSamplePairs = pcm48kStereo.length / bytesPerSamplePair;

  // Decimate 3:1 (48kHz → 16kHz)
  const decimation = 3;
  const outputLength = Math.floor(totalSamplePairs / decimation);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * decimation * bytesPerSamplePair;
    // Average left and right channels, normalize to [-1, 1]
    const left = pcm48kStereo.readInt16LE(srcIdx);
    const right = pcm48kStereo.readInt16LE(srcIdx + 2);
    output[i] = (left + right) / 2 / 32768;
  }

  return output;
}
