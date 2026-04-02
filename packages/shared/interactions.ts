/**
 * Interaction registries — shared between core and plugins.
 *
 * Contains ONLY the registries and register functions.
 * Dispatch logic (handleInteraction, safeHandle) stays in @choomfie/core.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { PluginContext } from "./plugin-context.ts";

// --- Handler types ---

export type ButtonHandler = (
  interaction: ButtonInteraction,
  parts: string[],
  ctx: PluginContext
) => Promise<void>;

export type ModalHandler = (
  interaction: ModalSubmitInteraction,
  parts: string[],
  ctx: PluginContext
) => Promise<void>;

export type CommandHandler = (
  interaction: ChatInputCommandInteraction,
  ctx: PluginContext
) => Promise<void>;

export interface CommandDef {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  handler: CommandHandler;
}

// --- Registries ---

export const buttonHandlers = new Map<string, ButtonHandler>();
export const modalHandlers = new Map<string, ModalHandler>();
export const commands = new Map<string, CommandDef>();

// --- Register functions ---

export function registerButtonHandler(prefix: string, handler: ButtonHandler) {
  buttonHandlers.set(prefix, handler);
}

export function registerModalHandler(prefix: string, handler: ModalHandler) {
  modalHandlers.set(prefix, handler);
}

export function registerCommand(
  name: string,
  def: { data: RESTPostAPIChatInputApplicationCommandsJSONBody; handler: CommandHandler }
) {
  commands.set(name, def);
}

/** Get all command definitions for deploy script */
export function getCommandDefs(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [...commands.values()].map((c) => c.data);
}
