import {
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type Role,
  type User,
} from "discord.js";
import type { Plugin, PluginContext } from "@choomfie/shared";
import { registerCommand } from "@choomfie/shared";
import { ReactionRoleDB } from "./db.ts";
import { emojiKeyFromInput, emojiKeyFromReaction } from "./emoji.ts";

type ReactionRoleAction = "add" | "remove";
type ReactionRoleStore = Pick<ReactionRoleDB, "get">;

let db: ReactionRoleDB | null = null;
let reactionAddHandler:
  | ((
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser
    ) => Promise<void>)
  | null = null;
let reactionRemoveHandler:
  | ((
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser
    ) => Promise<void>)
  | null = null;
let discordClient: Client | null = null;

registerCommand("reactionrole", {
  data: new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription("Configure reaction role mappings")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Assign a role when users react with an emoji")
        .addStringOption((option) =>
          option
            .setName("message_id")
            .setDescription("Message ID to watch in this channel")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription("Emoji to watch, such as ✅ or <:name:id>")
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Role to assign")
            .setRequired(true)
        )
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (!interaction.guild || !interaction.channel) {
      await interaction.reply({
        content: "Reaction roles can only be configured in a server channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!ctx.ownerUserId || interaction.user.id !== ctx.ownerUserId) {
      await interaction.reply({
        content: "Only the Choomfie owner can configure reaction roles.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!db) {
      await interaction.reply({
        content: "Reaction roles plugin is not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "add") return;

    const messageId = interaction.options.getString("message_id", true);
    const emojiInput = interaction.options.getString("emoji", true);
    const role = interaction.options.getRole("role", true) as Role;
    const emojiKey = emojiKeyFromInput(emojiInput);

    if (role.id === interaction.guild.id || role.managed) {
      await interaction.reply({
        content: "Choose a normal assignable server role.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: "I need the Manage Roles permission before I can assign reaction roles.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      await interaction.reply({
        content: `Move my highest role above ${role} before using it for reaction roles.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel;
    if (!channel.isTextBased() || !("messages" in channel)) {
      await interaction.reply({
        content: "Run this command in the text channel that contains the target message.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.react(emojiInput);
    } catch {
      await interaction.reply({
        content: "I could not find that message in this channel or react with that emoji.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    db.upsert({
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      messageId,
      emojiKey,
      roleId: role.id,
    });

    await interaction.reply({
      content: `Reaction role configured: ${emojiInput} on message \`${messageId}\` assigns ${role}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
});

async function resolveReaction(
  reaction: MessageReaction | PartialMessageReaction
): Promise<MessageReaction | null> {
  try {
    if (reaction.partial) {
      return (await reaction.fetch()) as MessageReaction;
    }
    return reaction as MessageReaction;
  } catch {
    return null;
  }
}

async function resolveUser(user: User | PartialUser): Promise<User | null> {
  try {
    if (user.partial) {
      return (await user.fetch()) as User;
    }
    return user as User;
  } catch {
    return null;
  }
}

async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionRoleAction
) {
  if (!db) return;
  await applyReactionRole(db, reaction, user, action);
}

export async function applyReactionRole(
  store: ReactionRoleStore,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  action: ReactionRoleAction
) {
  const resolvedUser = await resolveUser(user);
  if (!resolvedUser || resolvedUser.bot) return;

  const resolvedReaction = await resolveReaction(reaction);
  if (!resolvedReaction) return;

  const message = resolvedReaction.message;
  const guild = message.guild;
  if (!guild) return;

  const emojiKey = emojiKeyFromReaction(resolvedReaction);
  if (!emojiKey) return;

  const mapping = store.get(guild.id, message.id, emojiKey);
  if (!mapping) return;

  try {
    const member = await guild.members.fetch(resolvedUser.id);
    if (action === "add") {
      await member.roles.add(mapping.roleId, "Reaction role added");
    } else {
      await member.roles.remove(mapping.roleId, "Reaction role removed");
    }
  } catch (e) {
    console.error(`Reaction roles: failed to ${action} role ${mapping.roleId}: ${e}`);
  }
}

const reactionRolesPlugin: Plugin = {
  name: "reaction-roles",

  intents: [GatewayIntentBits.GuildMessageReactions],

  async init(ctx: PluginContext) {
    if (!ctx.discord) {
      console.error("Reaction roles: Discord unavailable, plugin disabled");
      return;
    }

    db = new ReactionRoleDB(`${ctx.DATA_DIR}/reaction-roles.db`);
    discordClient = ctx.discord;

    reactionAddHandler = (reaction, user) => handleReaction(reaction, user, "add");
    reactionRemoveHandler = (reaction, user) =>
      handleReaction(reaction, user, "remove");

    ctx.discord.on(Events.MessageReactionAdd, reactionAddHandler);
    ctx.discord.on(Events.MessageReactionRemove, reactionRemoveHandler);
    console.error("Reaction roles plugin initialized");
  },

  async destroy() {
    if (discordClient && reactionAddHandler) {
      discordClient.off(Events.MessageReactionAdd, reactionAddHandler);
    }
    if (discordClient && reactionRemoveHandler) {
      discordClient.off(Events.MessageReactionRemove, reactionRemoveHandler);
    }
    reactionAddHandler = null;
    reactionRemoveHandler = null;
    discordClient = null;
    db?.close();
    db = null;
  },
};

export default reactionRolesPlugin;
