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
} from "../core/anki-export.ts";

const MAX_BYTES = 20 * 1024 * 1024; // Discord cap is 25MB; stay under it.

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

      let body = formatAnkiTSV(cards, deck);
      let truncated = false;
      if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
        // Truncate to just under the cap on a line boundary.
        const buf = Buffer.from(body, "utf8").subarray(0, MAX_BYTES);
        const cut = buf.lastIndexOf(0x0a); // last '\n'
        body = buf.subarray(0, cut > 0 ? cut : buf.length).toString("utf8") + "\n";
        truncated = true;
      }

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
