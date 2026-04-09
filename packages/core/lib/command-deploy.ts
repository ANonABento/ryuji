import { Routes, type REST, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

export async function deployGuildCommands(
  rest: REST,
  applicationId: string,
  guildIds: Iterable<string>,
  commands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
): Promise<number> {
  let deployed = 0;
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: commands,
    });
    deployed++;
  }
  return deployed;
}
