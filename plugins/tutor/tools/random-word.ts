/**
 * Random word tool — picks a random N5 vocab word with spoiler-hidden meaning.
 */

import type { ToolDef } from "@choomfie/shared";
import { text } from "@choomfie/shared";

// Will be populated on first call
let vocabCache: Array<{ front: string; back: string; reading: string }> | null = null;

async function getVocab() {
  if (vocabCache) return vocabCache;
  const data = await import("../modules/japanese/data/n5-vocab.json");
  vocabCache = Array.isArray(data.default) ? data.default : data;
  return vocabCache;
}

export const randomWordTools: ToolDef[] = [
  {
    definition: {
      name: "random_word",
      description: "Get a random Japanese N5 vocabulary word. Great for daily practice or warm-up.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    handler: async (_args, _ctx) => {
      const vocab = await getVocab();
      if (!vocab || vocab.length === 0) return text("No vocabulary data available.");

      const word = vocab[Math.floor(Math.random() * vocab.length)];
      return text(
        [
          `📚 **Random Word**`,
          ``,
          `**${word.front}** (${word.reading})`,
          `Meaning: ||${word.back}||`,
          ``,
          `_React ✅ if you knew it!_`,
        ].join("\n")
      );
    },
  },
];
