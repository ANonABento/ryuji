/**
 * SRS export tool — ships cards as an Anki-compatible TSV.
 *
 * Filters by deck (exact) and/or tag (exact match against comma-split tag list).
 * When chat_id is provided, attaches the file to that Discord channel; otherwise
 * returns the path on disk for Claude to reference.
 */

import type { TextChannel, ThreadChannel } from "discord.js";
import type { ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";
import { getSRS } from "../core/srs-instance.ts";
import {
  formatAnkiTSV,
  buildExportFilename,
  writeAnkiExport,
  truncateBody,
} from "../core/anki-export.ts";

export const exportTools: ToolDef[] = [
  {
    definition: {
      name: "srs_export",
      description:
        "Export SRS flashcards as an Anki-compatible TSV file. Optional deck filter (exact name) and tag filter (exact match against the card's comma-separated tag list — NOT substring). When chat_id is provided the file is attached to that channel; otherwise the local file path is returned.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID whose cards to export",
          },
          deck: {
            type: "string",
            description: "Deck name to filter by (optional, exact match)",
          },
          tag: {
            type: "string",
            description:
              "Tag to filter by (optional, exact match against card's comma-separated tag list)",
          },
          chat_id: {
            type: "string",
            description:
              "Discord channel ID to send the file to (optional; if omitted, returns local path only)",
          },
        },
        required: ["user_id"],
      },
    },
    handler: async (args, ctx) => {
      const srs = getSRS();
      if (!srs) return err("SRS not initialized");

      const userId = args.user_id as string;
      const deck = args.deck as string | undefined;
      const tag = args.tag as string | undefined;
      const chatId = args.chat_id as string | undefined;

      const cards = srs.exportCards(userId, { deck, tag });
      if (cards.length === 0) {
        return err("No cards match that filter.");
      }

      const { body, truncated } = truncateBody(formatAnkiTSV(cards, deck));

      const filename = buildExportFilename(deck, tag);
      const dir = `${ctx.DATA_DIR}/exports`;
      const path = await writeAnkiExport(dir, filename, body);

      const summary = [
        `Exported ${cards.length} card${cards.length === 1 ? "" : "s"}`,
        deck ? `deck=${deck}` : null,
        tag ? `tag=${tag}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      if (!chatId) {
        return text(
          `${summary}${truncated ? " (truncated to fit Discord cap)" : ""}\nPath: ${path}`
        );
      }

      const channel = await ctx.discord?.channels.fetch(chatId);
      if (!channel?.isTextBased()) {
        return err(`Channel ${chatId} not found or not text-based`);
      }
      const tc = channel as TextChannel | ThreadChannel;
      await tc.send({
        content: `${summary}${truncated ? " (truncated to fit Discord cap)" : ""}`,
        files: [{ attachment: path, name: filename }],
      });

      return text(`${summary} — sent as ${filename}`);
    },
  },
];
