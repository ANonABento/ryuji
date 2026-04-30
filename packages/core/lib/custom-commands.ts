import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { CustomCommand } from "./memory.ts";

export const CUSTOM_COMMAND_NAME_RE = /^[a-z0-9_-]{1,32}$/;

export function isValidCustomCommandName(name: string): boolean {
  return CUSTOM_COMMAND_NAME_RE.test(name);
}

export function normalizeCustomCommandName(name: string): string {
  return name.trim().toLowerCase();
}

export function buildCustomCommandDefs(
  customCommands: Pick<CustomCommand, "name">[]
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return customCommands.map((command) =>
    new SlashCommandBuilder()
      .setName(command.name)
      .setDescription("Custom command")
      .toJSON()
  );
}

export function mergeCommandDefs(
  staticCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  customCommands: Pick<CustomCommand, "name">[]
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const staticNames = new Set(staticCommands.map((command) => command.name));
  const dynamic = buildCustomCommandDefs(
    customCommands.filter((command) => !staticNames.has(command.name))
  );
  return [...staticCommands, ...dynamic];
}
