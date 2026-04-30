import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateImage } from "../lib/image-generation.ts";

let tempDir: string | null = null;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

afterEach(async () => {
  process.env.OPENAI_API_KEY = originalOpenAiKey;
  process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

test("generateImage writes a local SVG fallback when image APIs are not configured", async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  tempDir = await mkdtemp(join(tmpdir(), "choomfie-image-test-"));

  const result = await generateImage("a cozy desk with a tiny robot lamp", tempDir);

  expect(result.provider).toBe("local-svg");
  expect(result.fallbackReason).toContain("OPENAI_API_KEY");
  expect(result.filePath.endsWith(".svg")).toBe(true);
  expect(result.filePath.startsWith(join(tempDir, "inbox"))).toBe(true);
  expect(existsSync(result.filePath)).toBe(true);

  const content = await readFile(result.filePath, "utf-8");
  expect(content).toContain("<svg");
  expect(content).toContain("a cozy desk");
});
