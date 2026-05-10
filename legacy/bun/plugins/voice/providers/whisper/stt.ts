/**
 * whisper.cpp STT provider — free, local, runs on Apple Silicon.
 *
 * Install: brew install whisper-cpp
 * Models auto-download on first use to ~/.cache/whisper-cpp/
 *
 * Default model: ggml-base.en (fast, English-only, ~150MB)
 * For multilingual: set WHISPER_MODEL=ggml-small (slower, 500MB)
 */

import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import type { STTProvider } from "../types.ts";
import { checkBinary } from "../detect.ts";

const DEFAULT_MODEL = "ggml-base.en";
const MODEL_CACHE_DIR = join(homedir(), ".cache", "whisper-cpp");

/** Resolve model name to full path — checks cache dir, then uses as-is */
function resolveModelPath(model: string): string {
  // Already a full path
  if (model.startsWith("/")) return model;
  // Add .bin extension if missing
  const withExt = model.endsWith(".bin") ? model : `${model}.bin`;
  const cached = join(MODEL_CACHE_DIR, withExt);
  if (existsSync(cached)) return cached;
  // Fall back to bare name (let whisper-cli handle it)
  return model;
}

/** Resolve the whisper binary — newer brew versions install as whisper-cli */
async function resolveWhisperBin(): Promise<string | null> {
  if (await checkBinary("whisper-cli")) return "whisper-cli";
  if (await checkBinary("whisper-cpp")) return "whisper-cpp";
  return null;
}

export const whisperSTT: STTProvider = {
  name: "whisper",

  async detect() {
    const bin = await resolveWhisperBin();
    return {
      available: !!bin,
      reason: bin ? `${bin} installed` : "whisper-cpp not found",
      install: bin ? undefined : "brew install whisper-cpp",
      type: "local" as const,
    };
  },

  async transcribe(audio: Buffer, language?: string): Promise<string> {
    const model = resolveModelPath(process.env.WHISPER_MODEL || DEFAULT_MODEL);

    // Write WAV to temp file (whisper-cpp needs a file path)
    const tempPath = join(tmpdir(), `choomfie-stt-${Date.now()}.wav`);

    try {
      await Bun.write(tempPath, audio);

      const args = [
        "--model",
        model,
        "--file",
        tempPath,
        "--output-txt",
        "--no-timestamps",
      ];

      if (language) {
        args.push("--language", language);
      }

      const bin = await resolveWhisperBin();
      if (!bin) throw new Error("whisper-cpp not found. Install: brew install whisper-cpp");

      const proc = Bun.spawn([bin, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`${bin} error (exit ${proc.exitCode}): ${stderr}`);
      }

      // whisper-cpp --output-txt writes to <input>.txt
      const txtPath = tempPath + ".txt";
      try {
        const text = await Bun.file(txtPath).text();
        unlinkSync(txtPath);
        return text.trim();
      } catch {
        // Some versions output to stdout instead
        console.error("whisper-cpp: no .txt output file, falling back to stdout");
        return stdout.trim();
      }
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // Already cleaned up
      }
    }
  },
};
