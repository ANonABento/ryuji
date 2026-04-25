/**
 * Interaction router — dispatches buttons, slash commands, and modal submissions.
 *
 * Re-exports shared registries so existing core imports don't break.
 * Handler logic lives in lib/handlers/ and lib/commands.ts.
 * All register themselves via side-effect imports at the bottom.
 */

import {
  MessageFlags,
  type Interaction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { AppContext } from "./types.ts";

// Re-export shared registries so existing core imports keep working
export {
  registerButtonHandler,
  registerModalHandler,
  registerCommand,
  getCommandDefs,
  buttonHandlers,
  modalHandlers,
  commands,
} from "@choomfie/shared";

import { buttonHandlers, modalHandlers, commands } from "@choomfie/shared";

// --- Error-safe interaction wrapper ---

type SafeHandleInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;

async function safeHandle(
  interaction: SafeHandleInteraction,
  label: string,
  fn: () => Promise<void>
) {
  try {
    await fn();
  } catch (e) {
    console.error(`${label}: ${e}`);
    if (interaction.deferred && interaction.editReply) {
      await interaction.editReply({ content: "Something went wrong." });
    } else if (!interaction.replied) {
      await interaction.reply({
        content: "Something went wrong.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

// --- Main router ---

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

  if (interaction.isChatInputCommand()) {
    const cmd = commands.get(interaction.commandName);
    if (cmd) {
      await safeHandle(interaction, `Command(${interaction.commandName})`, () =>
        cmd.handler(interaction, ctx)
      );
    }
    return;
  }

  if (interaction.isButton()) {
    const parts = interaction.customId.split(":");
    const handler = buttonHandlers.get(parts[0]);
    if (handler) {
      await safeHandle(interaction, `Button(${parts[0]})`, () =>
        handler(interaction, parts, ctx)
      );
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const parts = interaction.customId.split(":");
    const handler = modalHandlers.get(parts[0]);
    if (handler) {
      await safeHandle(interaction, `Modal(${parts[0]})`, () =>
        handler(interaction, parts, ctx)
      );
    }
  }
}

// --- Load handlers ---
// Dynamic imports avoid circular initialization issues.
// Handlers register themselves by calling registerButtonHandler/registerModalHandler/registerCommand.
await import("./handlers/reminder-buttons.ts");
await import("./handlers/permission-buttons.ts");
await import("./handlers/modals.ts");
await import("./commands.ts");
