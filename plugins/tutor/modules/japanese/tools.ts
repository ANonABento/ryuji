/**
 * Japanese-specific tools — only registered when Japanese module is loaded.
 */

import type { ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";
import * as kana from "./kana.ts";

export const japaneseTools: ToolDef[] = [
  {
    definition: {
      name: "convert_kana",
      description:
        "Convert between romaji, hiragana, and katakana. Useful for beginners learning to type Japanese.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Text to convert" },
          to: {
            type: "string",
            enum: ["hiragana", "katakana", "romaji"],
            description: "Target format",
          },
        },
        required: ["text", "to"],
      },
    },
    handler: async (args, _ctx) => {
      const input = args.text as string;
      const to = args.to as string;

      let result: string;
      switch (to) {
        case "hiragana":
          result = kana.toHiragana(input);
          break;
        case "katakana":
          result = kana.toKatakana(input);
          break;
        case "romaji":
          result = kana.toRomaji(input);
          break;
        default:
          return err(`Unknown target: ${to}`);
      }

      return text(`${input} → **${result}**`);
    },
  },
];
