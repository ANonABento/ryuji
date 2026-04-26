/**
 * Chinese-specific tutor tools.
 */

import type { ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";
import { convertHanzi, getHanziInfo } from "./hanzi.ts";
import { isValidNumberedPinyin, normalizePinyin } from "./pinyin.ts";

export const chineseTools: ToolDef[] = [
  {
    definition: {
      name: "convert_pinyin",
      description:
        "Convert Mandarin pinyin between tone marks and tone numbers, e.g. nǐ hǎo ↔ ni3 hao3.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Pinyin text to convert" },
          to: {
            type: "string",
            enum: ["marks", "numbers"],
            description: "Target pinyin style",
          },
        },
        required: ["text", "to"],
      },
    },
    handler: async (args) => {
      const input = args.text as string;
      const to = args.to as "marks" | "numbers";

      if (to !== "marks" && to !== "numbers") {
        return err(`Unknown target: ${to}`);
      }

      if (to === "marks" && !isValidNumberedPinyin(input)) {
        return err("Expected numbered pinyin such as `ni3 hao3`.");
      }

      return text(`${input} → **${normalizePinyin(input, to)}**`);
    },
  },
  {
    definition: {
      name: "stroke_info",
      description: "Show basic stroke count and radical information for a Chinese character.",
      inputSchema: {
        type: "object" as const,
        properties: {
          character: { type: "string", description: "Chinese character to inspect" },
        },
        required: ["character"],
      },
    },
    handler: async (args) => {
      const info = getHanziInfo(args.character as string);
      if (!info) {
        return text("No built-in stroke data for that character yet.");
      }

      return text(
        `**${info.character}** — ${info.strokes} strokes, radical **${info.radical}**, ${info.meaning}`
      );
    },
  },
  {
    definition: {
      name: "convert_hanzi",
      description:
        "Convert a small set of common Chinese characters between simplified and traditional forms.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Chinese text to convert" },
          to: {
            type: "string",
            enum: ["simplified", "traditional"],
            description: "Target character form",
          },
        },
        required: ["text", "to"],
      },
    },
    handler: async (args) => {
      const input = args.text as string;
      const to = args.to as "simplified" | "traditional";
      if (to !== "simplified" && to !== "traditional") {
        return err(`Unknown target: ${to}`);
      }

      return text(`${input} → **${convertHanzi(input, to)}**`);
    },
  },
];
