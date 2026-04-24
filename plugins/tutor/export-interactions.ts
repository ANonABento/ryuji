/**
 * /export slash command — Anki-compatible TSV of the caller's SRS cards.
 *
 * Optional `deck` (exact name) and `tag` (exact match against comma-split tag list)
 * filters. Uses deferReply because the file write + upload can take >3s for
 * large decks.
 */

import {
  SlashCommandBuilder,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import { registerCommand } from "@choomfie/shared";
import { getSRS } from "./core/srs-instance.ts";
import {
  formatAnkiTSV,
  buildExportFilename,
  writeAnkiExport,
  truncateBody,
} from "./core/anki-export.ts";

registerCommand("export", {
  data: new SlashCommandBuilder()
    .setName("export")
    .setDescription("Export your SRS flashcards as an Anki-compatible file")
    .addStringOption((opt) =>
      opt
        .setName("deck")
        .setDescription("Deck name to filter by (exact match)")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("tag")
        .setDescription(
          "Tag to filter by (exact match — not substring)"
        )
        .setRequired(false)
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    const srs = getSRS();
    if (!srs) {
      await interaction.reply({
        content: "Tutor plugin not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deck = interaction.options.getString("deck") ?? undefined;
    const tag = interaction.options.getString("tag") ?? undefined;
    const userId = interaction.user.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const cards = srs.exportCards(userId, { deck, tag });
    if (cards.length === 0) {
      await interaction.editReply("No cards match that filter.");
      return;
    }

    const { body, truncated } = truncateBody(formatAnkiTSV(cards, deck));

    const filename = buildExportFilename(deck, tag);
    const path = await writeAnkiExport(`${ctx.DATA_DIR}/exports`, filename, body);

    const summary = [
      `Exported **${cards.length}** card${cards.length === 1 ? "" : "s"}`,
      deck ? `deck: \`${deck}\`` : null,
      tag ? `tag: \`${tag}\`` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    await interaction.editReply({
      content: `${summary}${truncated ? "\n⚠️ Truncated to fit Discord's 25MB attachment cap." : ""}`,
      files: [new AttachmentBuilder(path, { name: filename })],
    });
  },
});
