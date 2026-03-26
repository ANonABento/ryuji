/**
 * Interaction handler — routes button clicks, slash commands, and modal submissions.
 *
 * Button customId format: "action:data" (e.g. "reminder:ack:42", "reminder:snooze:42:1h")
 * All interactions are handled directly (no Claude roundtrip) for instant response.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { AppContext } from "./types.ts";
import { getCommandHandler } from "./commands.ts";

/** Button handler signature */
type ButtonHandler = (
  interaction: ButtonInteraction,
  parts: string[],
  ctx: AppContext
) => Promise<void>;

/** Modal submit handler signature */
type ModalHandler = (
  interaction: ModalSubmitInteraction,
  parts: string[],
  ctx: AppContext
) => Promise<void>;

/** Registry of button handlers by prefix */
const buttonHandlers = new Map<string, ButtonHandler>();
/** Registry of modal handlers by prefix */
const modalHandlers = new Map<string, ModalHandler>();

/** Register a button handler for a prefix */
export function registerButtonHandler(prefix: string, handler: ButtonHandler) {
  buttonHandlers.set(prefix, handler);
}

/** Register a modal submit handler for a prefix */
export function registerModalHandler(prefix: string, handler: ModalHandler) {
  modalHandlers.set(prefix, handler);
}

/** Main interaction router — called from discord.ts */
export async function handleInteraction(
  interaction: Interaction,
  ctx: AppContext
) {
  // Let plugins handle first
  for (const plugin of ctx.plugins) {
    if (plugin.onInteraction) {
      try {
        await plugin.onInteraction(interaction, ctx);
      } catch (e) {
        console.error(`Plugin ${plugin.name} onInteraction error: ${e}`);
      }
    }
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const handler = getCommandHandler(interaction.commandName);
    if (handler) {
      try {
        await handler(interaction, ctx);
      } catch (e) {
        console.error(`Command handler error (${interaction.commandName}): ${e}`);
        const reply = {
          content: "Something went wrong.",
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.deferred) {
          await interaction.editReply(reply);
        } else if (!interaction.replied) {
          await interaction.reply(reply);
        }
      }
    }
    return;
  }

  // Buttons
  if (interaction.isButton()) {
    const parts = interaction.customId.split(":");
    const prefix = parts[0];
    const handler = buttonHandlers.get(prefix);

    if (handler) {
      try {
        await handler(interaction, parts, ctx);
      } catch (e) {
        console.error(`Button handler error (${prefix}): ${e}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Something went wrong.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }
    return;
  }

  // Modal submissions
  if (interaction.isModalSubmit()) {
    const parts = interaction.customId.split(":");
    const prefix = parts[0];
    const handler = modalHandlers.get(prefix);

    if (handler) {
      try {
        await handler(interaction, parts, ctx);
      } catch (e) {
        console.error(`Modal handler error (${prefix}): ${e}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Something went wrong.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }
  }
}

// --- Reminder button builders ---

/** Build action row with Done/Snooze buttons for a reminder */
export function buildReminderButtons(
  reminderId: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`reminder:ack:${reminderId}`)
      .setLabel("Done")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`reminder:snooze:${reminderId}:30m`)
      .setLabel("30min")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reminder:snooze:${reminderId}:1h`)
      .setLabel("1 hour")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reminder:snooze:${reminderId}:tomorrow`)
      .setLabel("Tomorrow")
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Parse snooze duration string into milliseconds */
function parseSnoozeDuration(duration: string): number | null {
  switch (duration) {
    case "30m":
      return 30 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "tomorrow":
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

// --- Register reminder button handlers ---

registerButtonHandler(
  "reminder",
  async (interaction, parts, ctx) => {
    const action = parts[1]; // "ack" or "snooze"
    const reminderId = parseInt(parts[2], 10);

    if (isNaN(reminderId)) {
      await interaction.reply({
        content: "Invalid reminder.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reminder = ctx.memory.getReminder(reminderId);
    if (!reminder) {
      await interaction.reply({
        content: "Reminder not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Only the reminder's user or the owner can interact
    const userId = interaction.user.id;
    if (userId !== reminder.userId && userId !== ctx.ownerUserId) {
      await interaction.reply({
        content: "Not your reminder~",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "ack") {
      const success = ctx.memory.ackReminder(reminderId);
      if (success) ctx.reminderScheduler.clearNagTimer(reminderId);

      // Update the original message — remove buttons, add checkmark
      await interaction.update({
        content: `~~${interaction.message.content}~~\n✅ Done!`,
        components: [],
      });
    } else if (action === "snooze") {
      const duration = parts[3] || "1h";
      const ms = parseSnoozeDuration(duration);

      if (!ms) {
        await interaction.reply({
          content: "Unknown snooze duration.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const newDueAt = new Date(Date.now() + ms).toISOString();
      const success = ctx.memory.snoozeReminder(reminderId, newDueAt);

      if (success) {
        const updated = ctx.memory.getReminder(reminderId);
        if (updated) ctx.reminderScheduler.scheduleReminder(updated);
      }

      const label =
        duration === "30m"
          ? "30 minutes"
          : duration === "1h"
            ? "1 hour"
            : "tomorrow";

      await interaction.update({
        content: `${interaction.message.content}\n⏰ Snoozed for ${label}`,
        components: [],
      });
    }
  }
);

// --- Modal builders ---

/** Build a reminder creation modal */
export function buildReminderModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("modal-remind")
    .setTitle("Set a Reminder")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("message")
          .setLabel("What to remind you about")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. Deploy the new build")
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("time")
          .setLabel("When")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. in 30 min, tomorrow 9am, 3pm")
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("recurring")
          .setLabel("Recurring? (leave empty for one-off)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("hourly, daily, weekly, monthly, every 2h")
          .setRequired(false)
          .setMaxLength(20)
      )
    );
}

/** Build a persona creation modal */
export function buildPersonaModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("modal-persona")
    .setTitle("Create a Persona")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("key")
          .setLabel("Key (lowercase, no spaces)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. pirate, yoda, chill")
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Display Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. Captain Jack")
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("personality")
          .setLabel("Personality Description")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Describe how this persona talks, acts, and thinks...")
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
}

/** Build a memory save modal */
export function buildMemoryModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("modal-memory")
    .setTitle("Save a Memory")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("key")
          .setLabel("Memory Key")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. favorite_language, timezone, project")
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("What to Remember")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("The information to store...")
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

// --- Modal submit handlers ---

registerModalHandler(
  "modal-remind",
  async (interaction, _parts, ctx) => {
    const message = interaction.fields.getTextInputValue("message");
    const timeStr = interaction.fields.getTextInputValue("time");
    const recurring = interaction.fields.getTextInputValue("recurring") || null;

    // Reuse the natural time parser from commands.ts
    const { parseNaturalTime } = await import("./commands.ts");
    const dueAt = parseNaturalTime(timeStr);

    if (!dueAt) {
      await interaction.reply({
        content: `Couldn't parse time: "${timeStr}". Try "in 30 min", "tomorrow 9am", etc.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate recurring pattern if provided
    const validCron = ["hourly", "daily", "weekly", "monthly"];
    const cronMatch = recurring?.match(/^every\s+\d+\s*(m|min|h|hr|d|day)s?$/i);
    if (recurring && !validCron.includes(recurring) && !cronMatch) {
      await interaction.reply({
        content: `Invalid recurring pattern: "${recurring}". Use hourly, daily, weekly, monthly, or "every Xh".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const newId = ctx.memory.addReminder(
      interaction.user.id,
      interaction.channelId!,
      message,
      dueAt.toISOString(),
      { cron: recurring ?? undefined }
    );

    const reminder = ctx.memory.getReminder(newId);
    if (reminder) ctx.reminderScheduler.scheduleReminder(reminder);

    const ts = Math.floor(dueAt.getTime() / 1000);
    const parts = [`**Reminder set** for <t:${ts}:R>: ${message}`];
    if (recurring) parts.push(`Recurring: ${recurring}`);

    await interaction.reply({ content: parts.join("\n") });
  }
);

registerModalHandler(
  "modal-persona",
  async (interaction, _parts, ctx) => {
    const key = interaction.fields.getTextInputValue("key").toLowerCase().replace(/\s+/g, "-");
    const name = interaction.fields.getTextInputValue("name");
    const personality = interaction.fields.getTextInputValue("personality");

    ctx.config.savePersona(key, name, personality);

    await interaction.reply({
      content: `**Persona created:** \`${key}\` — **${name}**\n${personality}\n\nSwitch with \`/persona switch:${key}\` or ask me to switch.`,
    });
  }
);

registerModalHandler(
  "modal-memory",
  async (interaction, _parts, ctx) => {
    const key = interaction.fields.getTextInputValue("key");
    const value = interaction.fields.getTextInputValue("value");

    ctx.memory.setCoreMemory(key, value);

    await interaction.reply({
      content: `**Memory saved:** \`${key}\` = ${value}`,
      flags: MessageFlags.Ephemeral,
    });
  }
);
