/**
 * Kokoro TTS provider — free, local, high-quality neural TTS.
 *
 * Install:
 *   pip install kokoro-onnx soundfile
 *
 * Models auto-download on first use (~300MB).
 * Runs on CPU (Apple Silicon optimized via CoreML), ~150ms latency.
 *
 * Voices: af_heart (default), af_sky, am_adam, bf_emma, etc.
 * See: https://github.com/thewh1teagle/kokoro-onnx
 *
 * Uses a persistent Python subprocess to keep the ONNX session warm,
 * reducing per-sentence synthesis time from ~200ms to ~80-120ms.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import type { TTSProvider } from "../types.ts";
import { checkPythonModule, getPython } from "../detect.ts";
import { toDiscordPcm } from "../audio.ts";

const DEFAULT_VOICE = "af_heart";

// Persistent server script — reads JSON lines from stdin, writes JSON lines to stdout.
// First stdout line is {"status":"ready"} after model loads.
const KOKORO_SERVER_SCRIPT = `
import sys, json, soundfile as sf, tempfile, os
from kokoro_onnx import Kokoro

kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
sys.stdout.write(json.dumps({"status": "ready"}) + "\\n")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        samples, sr = kokoro.create(req["text"], voice=req["voice"], speed=1.0)
        fd, out = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        sf.write(out, samples, sr)
        sys.stdout.write(json.dumps({"path": out}) + "\\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({"error": str(e)}) + "\\n")
        sys.stdout.flush()
`;

/**
 * Persistent Kokoro subprocess — spawned once, keeps ONNX session warm.
 * Serializes synthesis calls so stdout reads don't interleave.
 */
class KokoroSession {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readBuffer = "";
  private startPromise: Promise<void> | null = null;
  /** Serializes synthesis calls — Python server handles one request at a time */
  private synthLock: Promise<void> = Promise.resolve();

  async ensureStarted(python: string): Promise<void> {
    if (this.proc) return;
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    this.startPromise = this._start(python).finally(() => {
      this.startPromise = null;
    });
    await this.startPromise;
  }

  private async _start(python: string): Promise<void> {
    console.error("Kokoro: starting persistent session (loading ONNX model)...");

    const proc = Bun.spawn([python, "-c", KOKORO_SERVER_SCRIPT], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.proc = proc;

    // Log stderr in background without blocking startup
    const stderrStream = proc.stderr;
    void (async () => {
      const reader = stderrStream.getReader();
      const dec = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = dec.decode(value);
          for (const line of text.split("\n")) {
            if (line.trim()) console.error(`Kokoro: ${line}`);
          }
        }
      } catch { /* ignore — process exited */ }
    })();

    this.reader = proc.stdout.getReader();

    // First stdout line is {"status":"ready"} once the model is loaded
    const readyLine = await Promise.race([
      this._readLine(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Kokoro startup timeout (60s)")), 60_000)
      ),
    ]);

    const msg = JSON.parse(readyLine) as { status?: string; error?: string };
    if (msg.error) throw new Error(`Kokoro server error: ${msg.error}`);
    if (msg.status !== "ready") throw new Error(`Kokoro unexpected startup: ${readyLine}`);

    console.error("Kokoro: persistent session ready");
  }

  private async _readLine(): Promise<string> {
    if (!this.reader) throw new Error("Kokoro reader not initialized");

    while (true) {
      const nlIdx = this.readBuffer.indexOf("\n");
      if (nlIdx >= 0) {
        const line = this.readBuffer.slice(0, nlIdx).trim();
        this.readBuffer = this.readBuffer.slice(nlIdx + 1);
        return line;
      }

      const { value, done } = await this.reader.read();
      if (done) {
        this.proc = null;
        this.reader = null;
        throw new Error("Kokoro server exited unexpectedly");
      }
      this.readBuffer += new TextDecoder().decode(value);
    }
  }

  private async _doSynthesize(text: string, voice: string): Promise<string> {
    if (!this.proc) throw new Error("Kokoro server not running");

    const request = JSON.stringify({ text, voice }) + "\n";
    this.proc.stdin.write(request);

    const line = await this._readLine();
    const result = JSON.parse(line) as { path?: string; error?: string };

    if (result.error) throw new Error(`Kokoro synthesis error: ${result.error}`);
    if (!result.path) throw new Error("Kokoro: no path in response");

    return result.path;
  }

  async synthesize(text: string, voice: string, python: string): Promise<string> {
    let wavPath!: string;
    // Chain onto the lock so only one synthesis runs at a time
    const task: Promise<void> = this.synthLock.then(async () => {
      await this.ensureStarted(python);
      wavPath = await this._doSynthesize(text, voice);
    });
    // Next call waits for this one even if it fails
    this.synthLock = task.then(undefined, () => {});
    await task;
    return wavPath;
  }

  stop(): void {
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.proc = null;
    this.reader = null;
    this.readBuffer = "";
    this.startPromise = null;
    this.synthLock = Promise.resolve();
  }
}

// Module-level singleton — one persistent session per worker lifetime
const session = new KokoroSession();

export const kokoroTTS: TTSProvider = {
  name: "kokoro",

  async detect() {
    const has = await checkPythonModule("kokoro_onnx");
    return {
      available: has,
      reason: has ? "kokoro-onnx installed" : "kokoro-onnx not found",
      install: has ? undefined : "pip install kokoro-onnx soundfile",
      type: "local" as const,
    };
  },

  async synthesize(text: string, _language: string = "en", speed: number = 1.0): Promise<Buffer> {
    if (!text?.trim()) throw new Error("Cannot synthesize empty text");

    const voice = process.env.KOKORO_VOICE || DEFAULT_VOICE;
    const python = getPython();

    console.error(`Kokoro TTS: speed=${speed}, text="${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`);

    const tempWav = await session.synthesize(text, voice, python);

    try {
      // kokoro-onnx has int32 bug with fractional speeds — apply via ffmpeg atempo instead
      return await toDiscordPcm(tempWav, speed);
    } finally {
      try { unlinkSync(tempWav); } catch { /* already cleaned up */ }
    }
  },
};
