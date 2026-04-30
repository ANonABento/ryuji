/**
 * Welcome message handler + owner-only slash command.
 */

import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type GuildMember,
} from "discord.js";
import { DEFAULT_WELCOME_TEMPLATE } from "../config.ts";
import { registerCommand } from "../interactions.ts";
import type { AppContext } from "../types.ts";
import { requireOwner } from "./shared.ts";

const MAX_TEMPLATE_LENGTH = 1000;

export function renderWelcomeTemplate(
  template: string,
  member: Pick<GuildMember, "id" | "displayName"> & {
    user: Pick<GuildMember["user"], "username">;
    guild: Pick<GuildMember["guild"], "name" | "memberCount">;
  }
): string {
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{displayName}", member.displayName)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", String(member.guild.memberCount));
}

export async function handleGuildMemberAdd(
  member: GuildMember,
  ctx: AppContext
): Promise<void> {
  if (member.user.bot) return;

  const welcome = ctx.config.getWelcomeConfig();
  if (!welcome.channelId) return;

  const template = welcome.template?.trim() || DEFAULT_WELCOME_TEMPLATE;
  const content = renderWelcomeTemplate(template, member);

  try {
    const channel = await member.guild.channels.fetch(welcome.channelId);
    if (!channel?.isTextBased()) return;

    await channel.send({
      content,
      allowedMentions: { users: [member.id], roles: [], parse: [] },
    });
    ctx.messageStats.sent++;
  } catch (e) {
    console.error(`Welcome message failed: ${e}`);
  }
}

registerCommand("welcome_config", {
  data: new SlashCommandBuilder()
    .setName("welcome_config")
    .setDescription("Configure new member welcome messages (owner only)")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel where welcome messages should be sent")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((o) =>
      o
        .setName("template")
        .setDescription("Message template. Supports {user}, {username}, {displayName}, {server}, {memberCount}")
        .setMaxLength(MAX_TEMPLATE_LENGTH)
    )
    .addBooleanOption((o) =>
      o
        .setName("enabled")
        .setDescription("Turn welcome messages on or off")
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Welcome messages can only be configured in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel("channel");
    const template = interaction.options.getString("template");
    const enabled = interaction.options.getBoolean("enabled");
    const current = ctx.config.getWelcomeConfig();

    const next = {
      channelId: current.channelId,
      template: current.template || DEFAULT_WELCOME_TEMPLATE,
    };

    if (channel) next.channelId = channel.id;
    if (template !== null) next.template = template.trim() || DEFAULT_WELCOME_TEMPLATE;
    if (enabled === false) next.channelId = null;

    const hasChanges = channel !== null || template !== null || enabled !== null;
    if (hasChanges) {
      if (enabled === true && !next.channelId) {
        await interaction.reply({
          content: "Choose a channel before enabling welcome messages.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      ctx.config.setWelcomeConfig(next);
    }

    const updated = ctx.config.getWelcomeConfig();
    const status = updated.channelId ? `enabled in <#${updated.channelId}>` : "disabled";
    const previewMember = {
      id: interaction.user.id,
      displayName: interaction.member && "displayName" in interaction.member
        ? String(interaction.member.displayName)
        : interaction.user.username,
      user: { username: interaction.user.username },
      guild: {
        name: interaction.guild?.name ?? "this server",
        memberCount: interaction.guild?.memberCount ?? 0,
      },
    };
    const preview = renderWelcomeTemplate(updated.template, previewMember);

    await interaction.reply({
      content: [
        `Welcome messages are **${status}**.`,
        `Template: \`${updated.template}\``,
        `Preview: ${preview}`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  },
});
