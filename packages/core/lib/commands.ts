/**
 * Slash commands — definition + handlers.
 *
 * Commands are registered once via `deployCommands()` (run separately or on startup).
 * Handlers are called from interactions.ts when a ChatInputCommand interaction arrives.
 *
 * All commands respond directly (no Claude roundtrip) for instant response.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { findMonorepoRoot } from "@choomfie/shared";
import { VERSION } from "./version.ts";
import { getCommandDefs, registerCommand, registerButtonHandler } from "./interactions.ts";
import { McpProxy } from "./mcp-proxy.ts";
import { formatDuration, fromSQLiteDatetime } from "./time.ts";
import { isOwner, requireOwner } from "./handlers/shared.ts";
import { buildGhArgs, runGh } from "./handlers/github.ts";
import { discoverPlugins } from "./plugins.ts";
import { translateText } from "./translation.ts";
import {
  buildReminderModal,
  buildPersonaModal,
  buildMemoryModal,
} from "./handlers/modals.ts";
import type { IncomingWebhook } from "./memory.ts";
import { buildWebhookUrl, generateWebhookToken } from "./webhooks.ts";

const DISCORD_CONTENT_LIMIT = 2000;

function fitDiscordContent(content: string): string {
  if (content.length <= DISCORD_CONTENT_LIMIT) return content;
  return content.slice(0, DISCORD_CONTENT_LIMIT - 3) + "...";
}

// --- Command definitions ---

async function redeployCommands(ctx: AppContext): Promise<number> {
  const commands = mergeCommandDefs(getCommandDefs(), ctx.memory.listCustomCommands());
  const deployed = await deployCurrentGuildCommands(ctx, commands);
  await Bun.write(`${ctx.DATA_DIR}/.commands-hash`, Bun.hash(JSON.stringify(commands)).toString(36));
  return deployed;
}

// /remind — opens a modal form
registerCommand("remind", {
  data: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set a reminder via form")
    .toJSON(),
  handler: async (interaction) => {
    await interaction.showModal(buildReminderModal());
  },
});

// /reminders — list active reminders
registerCommand("reminders", {
  data: new SlashCommandBuilder()
    .setName("reminders")
    .setDescription("List your active reminders")
    .toJSON(),
  handler: async (interaction, ctx) => {
    const active = ctx.memory.getActiveReminders(interaction.user.id);
    const unacked = ctx.memory.getUnackedReminders(interaction.user.id);

    if (active.length === 0 && unacked.length === 0) {
      await interaction.reply({
        content: "No active reminders.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder().setColor(0xf0883e).setTitle("Your Reminders");

    if (unacked.length > 0) {
      const lines = unacked.map((r) => `⚠️ **#${r.id}** — ${r.message}`);
      embed.addFields({ name: "Nagging", value: lines.join("\n") });
    }
    if (active.length > 0) {
      const lines = active.map((r) => {
        const ts = Math.floor(fromSQLiteDatetime(r.dueAt).getTime() / 1000);
        const cron = r.cron ? ` · ${r.cron}` : "";
        const timezone = r.timezone ? ` · ${r.timezone}` : "";
        return `⏰ **#${r.id}** — ${r.message} · <t:${ts}:R>${timezone}${cron}`;
      });
      embed.addFields({ name: "Pending", value: lines.join("\n") });
    }

    embed.setFooter({ text: `${active.length + unacked.length} total · /cancel <id> to remove` });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
});

// /cancel <id> — quick cancel a reminder
registerCommand("cancel", {
  data: new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Cancel a reminder by ID")
    .addIntegerOption((o) =>
      o.setName("id").setDescription("Reminder ID (from /reminders)").setRequired(true)
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    const id = interaction.options.getInteger("id", true);
    const reminder = ctx.memory.getReminder(id);

    if (!reminder) {
      await interaction.reply({
        content: `Reminder #${id} not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (reminder.userId !== interaction.user.id && !isOwner(ctx, interaction.user.id)) {
      await interaction.reply({
        content: "That's not your reminder.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    ctx.memory.cancelReminder(id);
    ctx.reminderScheduler.clearTimer(id);
    ctx.reminderScheduler.clearNagTimer(id);

    await interaction.reply({
      content: `Cancelled reminder **#${id}**: ${reminder.message}`,
      flags: MessageFlags.Ephemeral,
    });
  },
});

// /memory [search] — list or search memories
registerCommand("memory", {
  data: new SlashCommandBuilder()
    .setName("memory")
    .setDescription("View or search memories")
    .addStringOption((o) =>
      o.setName("search").setDescription("Search term (omit to list all core memories)")
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    const search = interaction.options.getString("search");

    if (search) {
      const core = ctx.memory.getCoreMemory().filter(
        (m) => m.key.includes(search) || m.value.toLowerCase().includes(search.toLowerCase())
      );
      const archival = ctx.memory.searchArchival(search, 5);

      if (core.length === 0 && archival.length === 0) {
        await interaction.reply({
          content: `No memories matching "${search}".`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Memory Search: "${search}"`);

      if (core.length > 0) {
        const lines = core.map((m) => `**${m.key}** — ${m.value.slice(0, 100)}`);
        embed.addFields({ name: "Core", value: lines.join("\n").slice(0, 1024) });
      }
      if (archival.length > 0) {
        const lines = archival.map((m) => `${m.content.slice(0, 100)}`);
        embed.addFields({ name: "Archival", value: lines.join("\n").slice(0, 1024) });
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      const core = ctx.memory.getCoreMemory();
      if (core.length === 0) {
        await interaction.reply({
          content: "No core memories saved yet.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Core Memories")
        .setDescription(
          core.map((m) => `**${m.key}** — ${m.value.slice(0, 80)}`).join("\n").slice(0, 4000)
        )
        .setFooter({ text: `${core.length} memories · /memory <search> to search` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
});

// /help — show all commands and capabilities
registerCommand("help", {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands and what I can do")
    .toJSON(),
  handler: async (interaction) => {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("Choomfie Commands")
      .addFields(
        {
          name: "Reminders",
          value: [
            "`/remind` — set a reminder (form)",
            "`/reminders` — list active reminders",
            "`/cancel <id>` — cancel a reminder",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Memory",
          value: [
            "`/memory` — list core memories",
            "`/memory <search>` — search memories",
            "`/savememory` — save a memory (form)",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Personas",
          value: [
            "`/persona` — list all personas",
            "`/persona switch:<key>` — switch persona",
            "`/newpersona` — create a persona (form)",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Plugins",
          value: [
            "`/plugins` — list available plugins",
            "`/plugins enable:<name>` — enable a plugin",
            "`/plugins disable:<name>` — disable a plugin",
            "`/voice` — voice provider setup wizard",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Other",
          value: [
            "`/translate <target_lang> <text>` — translate text",
            "`/github <check>` — PRs, issues, notifications",
            "`/webhook create` — create an incoming webhook for a channel",
            "`/status` — bot status and stats",
            "`/local_check` — validate local services for offline mode",
          ].join("\n"),
          inline: false,
        },
        {
          name: "In Chat",
          value:
            "You can also just talk to me! Ask me to set reminders, remember things, check GitHub, switch personas, or anything else.",
          inline: false,
        }
      )
      .setFooter({ text: "@ me in a server or DM me directly" });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});

// /translate <target_lang> <text>
registerCommand("translate", {
  data: new SlashCommandBuilder()
    .setName("translate")
    .setDescription("Translate text with automatic source-language detection")
    .addStringOption((o) =>
      o
        .setName("target_lang")
        .setDescription("Target language, e.g. English, Spanish, Japanese, or pt-BR")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription("Text to translate")
        .setRequired(true)
    )
    .toJSON(),
  handler: async (interaction) => {
    await interaction.deferReply();

    const targetLang = interaction.options.getString("target_lang", true);
    const sourceText = interaction.options.getString("text", true);

    try {
      const translated = await translateText({ targetLang, text: sourceText });
      await interaction.editReply({ content: fitDiscordContent(translated) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        content: fitDiscordContent(`Translation failed: ${message}`),
      });
    }
  },
});

// /github <subcommand>
registerCommand("github", {
  data: new SlashCommandBuilder()
    .setName("github")
    .setDescription("Check GitHub status")
    .addStringOption((o) =>
      o
        .setName("check")
        .setDescription("What to check")
        .setRequired(true)
        .addChoices(
          { name: "Open PRs", value: "prs" },
          { name: "Open Issues", value: "issues" },
          { name: "Notifications", value: "notifications" },
          { name: "Current PR Status", value: "pr_status" }
        )
    )
    .addStringOption((o) =>
      o.setName("repo").setDescription("Repository (owner/repo format, optional)")
    )
    .toJSON(),
  handler: async (interaction) => {
    await interaction.deferReply();

    const command = interaction.options.getString("check", true);
    const repo = interaction.options.getString("repo");
    const ghArgs = buildGhArgs(command, repo);

    if (!ghArgs) {
      await interaction.editReply({ content: `Unknown command: ${command}` });
      return;
    }

    try {
      const output = await runGh(ghArgs);
      await interaction.editReply({ content: `\`\`\`\n${output.slice(0, 1900)}\n\`\`\`` });
    } catch (error: unknown) {
      await interaction.editReply({ content: `GitHub CLI error: ${getErrorMessage(error)}` });
    }
  },
});

// /customcmd — owner-defined text aliases
registerCommand("customcmd", {
  data: new SlashCommandBuilder()
    .setName("customcmd")
    .setDescription("Manage custom commands (owner only)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add or update a custom command")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Command name, used as /name")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32)
        )
        .addStringOption((o) =>
          o
            .setName("response")
            .setDescription("Text response")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2000)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List custom commands")
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a custom command")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Command name")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32)
        )
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;

    const action = interaction.options.getSubcommand(true);

    if (action === "list") {
      const customCommands = ctx.memory.listCustomCommands();
      if (customCommands.length === 0) {
        await interaction.reply({
          content: "No custom commands defined.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = customCommands.map(
        (command) => `\`/${command.name}\` — ${command.response.slice(0, 80)}`
      );
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Custom Commands")
        .setDescription(lines.join("\n").slice(0, 4000))
        .setFooter({ text: `${customCommands.length} custom command(s)` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const name = normalizeCustomCommandName(interaction.options.getString("name", true));
    if (!isValidCustomCommandName(name)) {
      await interaction.reply({
        content: "Command names must be 1-32 characters: lowercase letters, numbers, `_`, or `-`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (action === "add") {
      const builtInNames = new Set(getCommandDefs().map((command) => command.name));
      if (builtInNames.has(name)) {
        await interaction.editReply({
          content: `\`/${name}\` is a built-in command and cannot be overridden.`,
        });
        return;
      }

      const response = interaction.options.getString("response", true).trim();
      if (!response) {
        await interaction.editReply({ content: "Response cannot be empty." });
        return;
      }

      ctx.memory.setCustomCommand(name, response, interaction.user.id);
      const deployed = await redeployCommands(ctx);
      await interaction.editReply({
        content: `Added \`/${name}\` and deployed commands to ${deployed} guild(s).`,
      });
      return;
    }

    if (action === "delete") {
      const deleted = ctx.memory.deleteCustomCommand(name);
      if (!deleted) {
        await interaction.editReply({ content: `\`/${name}\` was not found.` });
        return;
      }

      const deployed = await redeployCommands(ctx);
      await interaction.editReply({
        content: `Deleted \`/${name}\` and deployed commands to ${deployed} guild(s).`,
      });
    }
  },
});

// /status
registerCommand("status", {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show bot status and stats")
    .toJSON(),
  handler: async (interaction, ctx) => {
    const stats = ctx.memory.getStats();
    const uptime = ctx.startedAt ? formatDuration(Date.now() - ctx.startedAt) : "unknown";
    const persona = ctx.config.getActivePersona();
    const personas = ctx.config.listPersonas();
    const botUser = ctx.discord.user;

    // Plugin info (voice details folded in when enabled)
    const enabledPlugins = ctx.config.getEnabledPlugins();
    const voiceConfig = ctx.config.getVoiceConfig();
    const pluginStatus = enabledPlugins.length > 0
      ? enabledPlugins.map((p) => {
          const loaded = ctx.plugins.find((pl) => pl.name === p);
          const tools = loaded?.tools?.length ?? 0;
          if (p === "voice" && loaded) {
            return `voice (${tools}t) STT=${voiceConfig.stt} TTS=${voiceConfig.tts}`;
          }
          return loaded ? `${p} (${tools}t)` : `${p} ⚠️`;
        }).join("\n")
      : "none";

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setAuthor({
        name: `${botUser?.username ?? "Choomfie"} v${VERSION}`,
        iconURL: botUser?.displayAvatarURL() ?? undefined,
      })
      .addFields(
        { name: "Uptime", value: uptime, inline: true },
        { name: "Persona", value: `**${persona.name}**`, inline: true },
        { name: "Messages", value: `${ctx.messageStats.received} in / ${ctx.messageStats.sent} out`, inline: true },
        { name: "Memory", value: `${stats.coreCount} core · ${stats.archivalCount} archival`, inline: true },
        { name: "Reminders", value: `${stats.reminderCount} active`, inline: true },
        { name: "Access", value: `${ctx.allowedUsers.size} users`, inline: true },
        { name: "Plugins", value: pluginStatus, inline: true },
      )
      .setFooter({
        text: `Personas: ${personas.map((p) => p.active ? `[${p.key}]` : p.key).join(", ")}`,
      });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
});

// /persona [switch]
registerCommand("persona", {
  data: new SlashCommandBuilder()
    .setName("persona")
    .setDescription("View or switch personas")
    .addStringOption((o) =>
      o.setName("switch").setDescription("Persona key to switch to (omit to list all)")
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    const switchTo = interaction.options.getString("switch");
    const localFirst = ctx.config.getLocalFirst();

    if (switchTo) {
      if (await requireOwner(interaction, ctx)) return;
      const persona = ctx.config.switchPersona(switchTo);
      if (!persona) {
        const available = ctx.config
          .listPersonas()
          .map((p) => `\`${p.key}\``)
          .join(", ");
        await interaction.reply({
          content: `Persona "${switchTo}" not found. Available: ${available}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const compatNote = persona.model && !localFirst
        ? `\n⚠️ This persona has model \`${persona.model}\` but \`localFirst\` is off — model override won't apply.`
        : !persona.model && localFirst
        ? `\nℹ️ \`localFirst\` is on but this persona has no model override — using default local model hints.`
        : persona.model
        ? `\n✓ Model: \`${persona.model}\``
        : "";
      if (ctx.mcp instanceof McpProxy) {
        ctx.mcp.requestRestart(`persona switch: ${switchTo}`, interaction.channelId);
      }
      await interaction.reply({
        content: `Switched to **${persona.name}**. Restarting...${compatNote}`,
      });
    } else {
      const personas = ctx.config.listPersonas();
      const lines = personas.map(
        (p) =>
          `${p.active ? "→ " : "  "}\`${p.key}\` — **${p.persona.name}**${p.persona.model ? ` (\`${p.persona.model}\`)` : ""}`
      );
      const footer = localFirst ? "\n\n🔧 `localFirst` mode is **on**." : "";
      await interaction.reply({
        content: `**Personas:**\n${lines.join("\n")}${footer}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
});

// /newpersona — opens a modal form (owner only)
registerCommand("newpersona", {
  data: new SlashCommandBuilder()
    .setName("newpersona")
    .setDescription("Create a new persona via form (owner only)")
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;
    await interaction.showModal(buildPersonaModal());
  },
});

// /savememory — opens a modal form (owner only)
registerCommand("savememory", {
  data: new SlashCommandBuilder()
    .setName("savememory")
    .setDescription("Save something to memory via form (owner only)")
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;
    await interaction.showModal(buildMemoryModal());
  },
});

// /plugins — list, enable, disable plugins (owner only)
registerCommand("plugins", {
  data: new SlashCommandBuilder()
    .setName("plugins")
    .setDescription("Manage plugins (owner only)")
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("Action to perform (omit to list)")
        .addChoices(
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" }
        )
    )
    .addStringOption((o) =>
      o.setName("name").setDescription("Plugin name (e.g. voice, tutor, socials)")
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;

    const action = interaction.options.getString("action");
    const name = interaction.options.getString("name");

    const available = discoverPlugins();
    const enabled = ctx.config.getEnabledPlugins();

    if (!action) {
      // List plugins with status
      const lines = available.map((p) => {
        const inConfig = enabled.includes(p);
        const loadedPlugin = ctx.plugins.find((pl) => pl.name === p);
        const toolCount = loadedPlugin?.tools?.length;
        const tools = toolCount ? ` · ${toolCount} tools` : "";

        let status: string;
        if (loadedPlugin && inConfig) {
          status = `🟢 active${tools}`;
        } else if (inConfig && !loadedPlugin) {
          status = "🔴 enabled but failed to load";
        } else if (!inConfig && loadedPlugin) {
          status = "🟠 disabled (pending restart)";
        } else {
          status = "⚪ disabled";
        }
        return `${inConfig ? "→ " : "  "}\`${p}\` — ${status}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Plugins")
        .setDescription(lines.join("\n") || "No plugins found.")
        .setFooter({ text: `/plugins action:enable name:<plugin> to enable` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!name) {
      await interaction.reply({
        content: `Specify a plugin name: ${available.map((p) => `\`${p}\``).join(", ")}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!available.includes(name)) {
      await interaction.reply({
        content: `Plugin "${name}" not found. Available: ${available.map((p) => `\`${p}\``).join(", ")}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "enable") {
      if (enabled.includes(name)) {
        await interaction.reply({
          content: `\`${name}\` is already enabled.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      ctx.config.setEnabledPlugins([...enabled, name]);
      if (ctx.mcp instanceof McpProxy) {
        ctx.mcp.requestRestart(`plugin enable: ${name}`, interaction.channelId);
      }
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Plugin Enabled: ${name}`)
        .setDescription("Restarting to activate...")
        .setFooter({ text: `Enabled: ${[...enabled, name].join(", ")}` });
      await interaction.reply({ embeds: [embed] });
    } else {
      if (!enabled.includes(name)) {
        await interaction.reply({
          content: `\`${name}\` is already disabled.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const remaining = enabled.filter((p) => p !== name);
      ctx.config.setEnabledPlugins(remaining);
      if (ctx.mcp instanceof McpProxy) {
        ctx.mcp.requestRestart(`plugin disable: ${name}`, interaction.channelId);
      }
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`Plugin Disabled: ${name}`)
        .setDescription("Restarting to deactivate...")
        .setFooter({ text: remaining.length ? `Enabled: ${remaining.join(", ")}` : "No plugins enabled" });
      await interaction.reply({ embeds: [embed] });
    }
  },
});

// /webhook create|list|revoke — incoming HTTP webhooks (owner only)
function formatWebhookToken(token: string): string {
  return token.length > 8 ? `...${token.slice(-8)}` : token;
}

function formatWebhookListItem(webhook: IncomingWebhook): string {
  return `\`${formatWebhookToken(webhook.token)}\` -> <#${webhook.channelId}> by <@${
    webhook.createdBy
  }>`;
}

registerCommand("webhook", {
  data: new SlashCommandBuilder()
    .setName("webhook")
    .setDescription("Manage incoming webhooks (owner only)")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a webhook URL for a Discord channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to post into (defaults to this channel)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List active incoming webhooks")
    )
    .addSubcommand((sub) =>
      sub
        .setName("revoke")
        .setDescription("Revoke an incoming webhook token")
        .addStringOption((o) =>
          o
            .setName("token")
            .setDescription("Webhook token to revoke")
            .setRequired(true)
        )
    )
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;

    const action = interaction.options.getSubcommand(true);

    if (action === "create") {
      const selected = interaction.options.getChannel("channel");
      const channelId = selected?.id ?? interaction.channelId;
      const channel = await ctx.discord.channels.fetch(channelId).catch(() => null);

      if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
        await interaction.reply({
          content: "Choose a server text channel or thread for the webhook target.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let token = generateWebhookToken();
      while (ctx.memory.getIncomingWebhook(token)) {
        token = generateWebhookToken();
      }

      ctx.memory.addIncomingWebhook(
        token,
        channel.id,
        interaction.user.id,
        "guildId" in channel ? channel.guildId : interaction.guildId
      );

      await interaction.reply({
        content: [
          `Webhook created for <#${channel.id}>.`,
          `URL: \`${buildWebhookUrl(token)}\``,
          "POST JSON with `content`, `message`, or `text`, or POST plain text.",
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "list") {
      const webhooks = ctx.memory.listIncomingWebhooks();
      if (webhooks.length === 0) {
        await interaction.reply({
          content: "No active incoming webhooks.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = webhooks.map(formatWebhookListItem);

      await interaction.reply({
        content: `**Active incoming webhooks**\n${lines.join("\n").slice(0, 1900)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "revoke") {
      const token = interaction.options.getString("token", true).trim();
      const revoked = ctx.memory.revokeIncomingWebhook(token);
      await interaction.reply({
        content: revoked ? "Webhook revoked." : "Webhook token not found.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
});

// /voice setup — interactive provider wizard (owner only)
registerCommand("voice", {
  data: new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Voice plugin setup and status (owner only)")
    .toJSON(),
  handler: async (interaction, ctx) => {
    if (await requireOwner(interaction, ctx)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Dynamically import to avoid loading voice code when plugin isn't enabled
    const { detectAllProviders } = await import(
      "../../../plugins/voice/providers/index.ts"
    );

    let reports;
    try {
      reports = await detectAllProviders();
    } catch (error: unknown) {
      await interaction.editReply({
        content: `Provider detection failed: ${getErrorMessage(
          error
        )}. Check that ffmpeg and python3 are installed.`,
      });
      return;
    }
    const voiceConfig = ctx.config.getVoiceConfig();

    const sttReports = reports.filter((r) => r.kind === "stt");
    const ttsReports = reports.filter((r) => r.kind === "tts");

    const formatReport = (items: typeof reports) =>
      items
        .map((r) => {
          const icon = r.status.available ? "✅" : "❌";
          const active =
            voiceConfig.stt === r.name || voiceConfig.tts === r.name
              ? " ← active"
              : "";
          const install = r.status.install ? ` · \`${r.status.install}\`` : "";
          return `${icon} **${r.name}** — ${r.status.reason}${install}${active}`;
        })
        .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Voice Setup")
      .setDescription(
        `Current: STT=\`${voiceConfig.stt}\` TTS=\`${voiceConfig.tts}\`\nPick providers below.`
      )
      .addFields(
        { name: "STT Providers", value: formatReport(sttReports) },
        { name: "TTS Providers", value: formatReport(ttsReports) }
      )
      .setFooter({ text: "Select a provider or use Auto to let the bot choose" });

    // STT buttons
    const sttRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("voice-setup:stt:auto")
        .setLabel("Auto")
        .setStyle(voiceConfig.stt === "auto" ? ButtonStyle.Success : ButtonStyle.Secondary),
      ...sttReports.map((r) =>
        new ButtonBuilder()
          .setCustomId(`voice-setup:stt:${r.name}`)
          .setLabel(r.name)
          .setStyle(
            voiceConfig.stt === r.name ? ButtonStyle.Success : ButtonStyle.Primary
          )
          .setDisabled(!r.status.available)
      )
    );

    // TTS buttons
    const ttsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("voice-setup:tts:auto")
        .setLabel("Auto")
        .setStyle(voiceConfig.tts === "auto" ? ButtonStyle.Success : ButtonStyle.Secondary),
      ...ttsReports.map((r) =>
        new ButtonBuilder()
          .setCustomId(`voice-setup:tts:${r.name}`)
          .setLabel(r.name)
          .setStyle(
            voiceConfig.tts === r.name ? ButtonStyle.Success : ButtonStyle.Primary
          )
          .setDisabled(!r.status.available)
      )
    );

    await interaction.editReply({
      embeds: [embed],
      components: [sttRow, ttsRow],
    });
  },
});

// /local_check — validate all local services are up
registerCommand("local_check", {
  data: new SlashCommandBuilder()
    .setName("local_check")
    .setDescription("Validate all local services required for offline operation")
    .toJSON(),
  handler: async (interaction, ctx) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const isLocalFirst = ctx.config.isLocalFirst();
    const ollamaUrl = ctx.config.getOllamaUrl();
    const model = ctx.config.getLocalModel();

    // Check ollama
    let ollamaOk = false;
    let ollamaDetail = "not running";
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string }[] };
        const models = data.models?.map((m) => m.name) ?? [];
        ollamaOk = true;
        ollamaDetail = models.length
          ? `${models.length} model(s): ${models.slice(0, 3).join(", ")}`
          : "running (no models loaded)";
      } else {
        ollamaDetail = `HTTP ${res.status}`;
      }
    } catch (e) {
      ollamaDetail = (e as Error)?.name === "TimeoutError" ? "timed out (3s)" : "not running";
    }

    // Check whisper-cpp (try whisper-cli first, then whisper-cpp)
    let whisperOk = false;
    let whisperDetail = "not installed";
    try {
      for (const bin of ["whisper-cli", "whisper-cpp"]) {
        const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
        await proc.exited;
        if (proc.exitCode === 0) {
          whisperOk = true;
          whisperDetail = `found (${bin})`;
          break;
        }
      }
      if (!whisperOk) whisperDetail = "not installed — `brew install whisper-cpp`";
    } catch {
      whisperDetail = "detection failed";
    }

    // Check kokoro-onnx — prefer venv python if present
    let kokoroOk = false;
    let kokoroDetail = "not installed";
    try {
      const root = findMonorepoRoot(import.meta.dir);
      const venvPy = join(root, ".venv", "bin", "python3");
      const python = existsSync(venvPy) ? venvPy : "python3";
      const proc = Bun.spawn([python, "-c", "import kokoro_onnx"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      kokoroOk = proc.exitCode === 0;
      kokoroDetail = kokoroOk ? "found" : "not installed — `pip install kokoro-onnx soundfile`";
    } catch {
      kokoroDetail = "detection failed";
    }

    const allOk = ollamaOk && whisperOk && kokoroOk;
    const anyOk = ollamaOk || whisperOk || kokoroOk;
    const color = allOk ? 0x57f287 : anyOk ? 0xf0883e : 0xed4245;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${allOk ? "✅" : "⚠️"} Local Service Check`)
      .setDescription(
        isLocalFirst
          ? "Local-first mode is **enabled** — all API calls stay on-device."
          : "Local-first mode is **disabled** — enable with `config.localFirst = true` to go fully offline."
      )
      .addFields(
        {
          name: `${ollamaOk ? "✅" : "❌"} Ollama (LLM)`,
          value: `\`${ollamaUrl}\`\n${ollamaDetail}${ollamaOk ? ` · target model: \`${model}\`` : ""}`,
          inline: false,
        },
        {
          name: `${whisperOk ? "✅" : "❌"} whisper-cpp (STT)`,
          value: whisperDetail,
          inline: false,
        },
        {
          name: `${kokoroOk ? "✅" : "❌"} kokoro-onnx (TTS)`,
          value: kokoroDetail,
          inline: false,
        }
      )
      .setFooter({
        text: allOk
          ? "All local services ready — fully offline capable."
          : "Fix the services above to enable full offline operation.",
      });

    await interaction.editReply({ embeds: [embed] });
  },
});

// --- Voice setup button handler ---
registerButtonHandler("voice-setup", async (interaction, parts, ctx) => {
  if (!isOwner(ctx, interaction.user.id)) {
    await interaction.reply({
      content: "Only the owner can change voice settings.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [, kind, provider] = parts; // voice-setup:stt:whisper or voice-setup:tts:edge-tts
  if (kind !== "stt" && kind !== "tts") return;

  ctx.config.setVoiceConfig({ [kind]: provider });
  if (ctx.mcp instanceof McpProxy) {
    ctx.mcp.requestRestart(`voice config: ${kind}=${provider}`, interaction.channelId);
  }
  const voiceConfig = ctx.config.getVoiceConfig();

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Voice Config Updated")
    .addFields(
      { name: "STT", value: `\`${voiceConfig.stt}\``, inline: true },
      { name: "TTS", value: `\`${voiceConfig.tts}\``, inline: true }
    )
    .setFooter({ text: "Restarting to apply..." });

  await interaction.update({
    embeds: [embed],
    components: [],
  });
});
