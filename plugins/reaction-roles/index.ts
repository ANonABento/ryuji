import {
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Guild,
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
import { errorMessage, registerCommand } from "@choomfie/shared";
import { ReactionRoleDB } from "./db.ts";
import { emojiKeyFromInput, emojiKeyFromReaction } from "./emoji.ts";

type ReactionRoleAction = "add" | "remove";
type ReactionRoleStore = Pick<ReactionRoleDB, "get">;
type ReactionRoleEvent = MessageReaction | PartialMessageReaction;
type ReactionRoleUser = User | PartialUser;
type ReactionRoleHandler = (
  reaction: ReactionRoleEvent,
  user: ReactionRoleUser
) => Promise<void>;
type ReactionRoleReasonByAction = Record<ReactionRoleAction, string>;

const REACTION_ROLE_REASONS: ReactionRoleReasonByAction = {
  add: "Reaction role added",
  remove: "Reaction role removed",
};

let db: ReactionRoleDB | null = null;
let reactionAddHandler: ReactionRoleHandler | null = null;
let reactionRemoveHandler: ReactionRoleHandler | null = null;
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
    const replyEphemeral = async (content: string): Promise<void> => {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    };

    if (!interaction.guild || !interaction.channel) {
      await replyEphemeral("Reaction roles can only be configured in a server channel.");
      return;
    }

    if (!ctx.ownerUserId || interaction.user.id !== ctx.ownerUserId) {
      await replyEphemeral("Only the Choomfie owner can configure reaction roles.");
      return;
    }

    if (!db) {
      await replyEphemeral("Reaction roles plugin is not initialized.");
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "add") return;

    const messageId = interaction.options.getString("message_id", true);
    const emojiInput = interaction.options.getString("emoji", true).trim();
    const role = interaction.options.getRole("role", true) as Role;
    const emojiKey = emojiKeyFromInput(emojiInput);

    if (role.id === interaction.guild.id || role.managed) {
      await replyEphemeral("Choose a normal assignable server role.");
      return;
    }

    let botMember = interaction.guild.members.me;
    if (!botMember) {
      try {
        botMember = await interaction.guild.members.fetchMe();
      } catch {
        botMember = null;
      }
    }

    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await replyEphemeral(
        "I need the Manage Roles permission before I can assign reaction roles."
      );
      return;
    }

    if (!botMember.permissions.has(PermissionFlagsBits.AddReactions)) {
      await replyEphemeral(
        "I need the Add Reactions permission before I can validate emoji setup."
      );
      return;
    }

    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      await replyEphemeral(
        `Move my highest role above ${role} before using it for reaction roles.`
      );
      return;
    }

    const channel = interaction.channel;
    if (!channel.isTextBased() || !("messages" in channel)) {
      await replyEphemeral(
        "Run this command in the text channel that contains the target message."
      );
      return;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.react(emojiInput);
      db.upsert({
        guildId: interaction.guild.id,
        channelId: interaction.channelId,
        messageId,
        emojiKey,
        roleId: role.id,
      });
    } catch {
      await replyEphemeral(
        "I could not find that message in this channel or react with that emoji."
      );
      return;
    }

    await replyEphemeral(
      `Reaction role configured: ${emojiInput} on message \`${messageId}\` assigns ${role}.`
    );
  },
});

async function resolveReaction(
  reaction: ReactionRoleEvent
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

async function resolveUser(user: ReactionRoleUser): Promise<User | null> {
  try {
    if (user.partial) {
      return (await user.fetch()) as User;
    }
    return user as User;
  } catch {
    return null;
  }
}

async function resolveGuild(reaction: MessageReaction): Promise<Guild | null> {
  if (reaction.message.guild) return reaction.message.guild;

  const guildId = (reaction.message as MessageReaction["message"] & {
    guildId?: string | null;
  }).guildId;
  if (!guildId) return null;

  try {
    return await reaction.message.client.guilds.fetch(guildId);
  } catch {
    return null;
  }
}

async function handleReaction(
  reaction: ReactionRoleEvent,
  user: ReactionRoleUser,
  action: ReactionRoleAction
): Promise<void> {
  if (!db) return;
  await applyReactionRole(db, reaction, user, action);
}

export async function applyReactionRole(
  store: ReactionRoleStore,
  reaction: ReactionRoleEvent,
  user: ReactionRoleUser,
  action: ReactionRoleAction
): Promise<void> {
  const resolvedUser = await resolveUser(user);
  if (!resolvedUser || resolvedUser.bot) return;

  const resolvedReaction = await resolveReaction(reaction);
  if (!resolvedReaction) return;

  const guild = await resolveGuild(resolvedReaction);
  if (!guild) return;

  const message = resolvedReaction.message;
  const emojiKey = emojiKeyFromReaction(resolvedReaction);
  if (!emojiKey) return;

  const mapping = store.get(guild.id, message.channelId, message.id, emojiKey);
  if (!mapping) return;

  try {
    const member = await guild.members.fetch(resolvedUser.id);
    if (action === "add") {
      await member.roles.add(mapping.roleId, REACTION_ROLE_REASONS.add);
    } else {
      await member.roles.remove(mapping.roleId, REACTION_ROLE_REASONS.remove);
    }
  } catch (e) {
    console.error(
      `Reaction roles: failed to ${action} role ${mapping.roleId}: ${errorMessage(e)}`
    );
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
