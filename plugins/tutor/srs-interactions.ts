/**
 * SRS deck slash commands + modal handlers.
 */

import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { registerCommand, registerModalHandler } from "@choomfie/shared";
import { getSRS } from "./core/srs-instance.ts";
import type { SRSDeck } from "./core/srs.ts";

const MAX_DECK_NAME_LENGTH = 50;
const ADD_CARD_MODAL_TTL_MS = 15 * 60 * 1000;
const pendingAddCardDecks = new Map<string, { deck: string; expiresAt: number }>();

function normalizeDeckName(deck: string): string {
  return deck.trim().replace(/\s+/g, " ");
}

function validateDeckName(deck: string): string | null {
  if (!deck) return "Deck name is required.";
  if (deck.length > MAX_DECK_NAME_LENGTH) {
    return `Deck names must be ${MAX_DECK_NAME_LENGTH} characters or fewer.`;
  }
  return null;
}

function formatDeckLine(deck: SRSDeck): string {
  return `**${deck.name}** — ${deck.total} cards, ${deck.due} due, ${deck.learned} learned`;
}

function pruneExpiredAddCardDecks(now = Date.now()) {
  for (const [key, pending] of pendingAddCardDecks) {
    if (pending.expiresAt <= now) pendingAddCardDecks.delete(key);
  }
}

export function buildAddCardModal(userId: string, deck: string): ModalBuilder {
  pruneExpiredAddCardDecks();
  const token = crypto.randomUUID().slice(0, 12);
  pendingAddCardDecks.set(`${userId}:${token}`, {
    deck,
    expiresAt: Date.now() + ADD_CARD_MODAL_TTL_MS,
  });
  return new ModalBuilder()
    .setCustomId(`srs-add-card:${token}`)
    .setTitle(`Add Card: ${deck.slice(0, 33)}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("front")
          .setLabel("Front")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("back")
          .setLabel("Back")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reading")
          .setLabel("Reading (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("tags")
          .setLabel("Tags (optional, comma-separated)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
      )
    );
}

registerCommand("decks", {
  data: new SlashCommandBuilder()
    .setName("decks")
    .setDescription("Manage your SRS decks")
    .addSubcommand((s) =>
      s.setName("list").setDescription("List all of your SRS decks")
    )
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create an SRS deck")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Deck name")
            .setRequired(true)
            .setMaxLength(MAX_DECK_NAME_LENGTH)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete an SRS deck and all cards in it")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Deck name")
            .setRequired(true)
            .setMaxLength(MAX_DECK_NAME_LENGTH)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("stats")
        .setDescription("View SRS deck stats")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Deck name (omit for all decks)")
            .setRequired(false)
            .setMaxLength(MAX_DECK_NAME_LENGTH)
        )
    )
    .toJSON(),
  handler: async (interaction) => {
    const srs = getSRS();
    if (!srs) {
      await interaction.reply({
        content: "SRS is not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      const decks = srs.listDecks(userId);
      if (decks.length === 0) {
        await interaction.reply({
          content: "You do not have any SRS decks yet. Create one with `/decks create`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("SRS Decks")
        .setDescription(decks.map(formatDeckLine).join("\n").slice(0, 4000));
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "create") {
      const deck = normalizeDeckName(interaction.options.getString("name", true));
      const error = validateDeckName(deck);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const created = srs.createDeck(userId, deck);
      await interaction.reply({
        content: created ? `Created SRS deck **${deck}**.` : `SRS deck **${deck}** already exists.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "delete") {
      const deck = normalizeDeckName(interaction.options.getString("name", true));
      const { existed, deletedCards } = srs.deleteDeck(userId, deck);
      await interaction.reply({
        content: existed
          ? `Deleted SRS deck **${deck}** and ${deletedCards} cards.`
          : `SRS deck **${deck}** was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "stats") {
      const deck = interaction.options.getString("name");
      if (deck) {
        const name = normalizeDeckName(deck);
        if (!srs.hasDeck(userId, name)) {
          await interaction.reply({
            content: `SRS deck **${name}** was not found.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const stats = srs.getDeckStats(userId, name);
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`SRS Stats: ${name}`)
          .addFields(
            { name: "Total", value: String(stats.total), inline: true },
            { name: "Due", value: String(stats.due), inline: true },
            { name: "Learned", value: String(stats.learned), inline: true }
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const stats = srs.getDeckStats(userId);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("SRS Stats")
            .addFields(
              { name: "Total", value: String(stats.total), inline: true },
              { name: "Due", value: String(stats.due), inline: true },
              { name: "Learned", value: String(stats.learned), inline: true }
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
});

registerCommand("add_card", {
  data: new SlashCommandBuilder()
    .setName("add_card")
    .setDescription("Add a manual card to an SRS deck")
    .addStringOption((o) =>
      o
        .setName("deck")
        .setDescription("Deck name")
        .setRequired(true)
        .setMaxLength(MAX_DECK_NAME_LENGTH)
    )
    .toJSON(),
  handler: async (interaction) => {
    const srs = getSRS();
    if (!srs) {
      await interaction.reply({
        content: "SRS is not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deck = normalizeDeckName(interaction.options.getString("deck", true));
    const error = validateDeckName(deck);
    if (error) {
      await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(buildAddCardModal(interaction.user.id, deck));
  },
});

registerModalHandler("srs-add-card", async (interaction, parts) => {
  const srs = getSRS();
  if (!srs) {
    await interaction.reply({
      content: "SRS is not initialized.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const token = parts[1] ?? "";
  const pendingKey = `${interaction.user.id}:${token}`;
  pruneExpiredAddCardDecks();
  const pending = pendingAddCardDecks.get(pendingKey);
  pendingAddCardDecks.delete(pendingKey);
  if (!pending) {
    await interaction.reply({
      content: "This add-card form expired. Run `/add_card` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const deck = normalizeDeckName(pending.deck);
  const error = validateDeckName(deck);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    return;
  }

  const front = interaction.fields.getTextInputValue("front").trim();
  const back = interaction.fields.getTextInputValue("back").trim();
  const reading = interaction.fields.getTextInputValue("reading").trim();
  const tags = interaction.fields.getTextInputValue("tags").trim();

  if (!front || !back) {
    await interaction.reply({
      content: "Front and back are required.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cardId = srs.addCard(interaction.user.id, front, back, reading, deck, tags);
  await interaction.reply({
    content: `Added card **#${cardId}** to **${deck}**.`,
    flags: MessageFlags.Ephemeral,
  });
});
