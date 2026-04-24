/**
 * Discord client — creation, event handlers (Ready, MessageCreate).
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { handleInteraction, getCommandDefs } from "./interactions.ts";
import type { AppContext } from "./types.ts";
import { saveAccess } from "./context.ts";
import { ReminderScheduler } from "./reminders.ts";
import { onMessageReceived } from "./typing.ts";
import {
  isChannelActive,
  activateChannel,
  refreshChannel,
  isRateLimited,
} from "./conversation.ts";
import {
  GAP_RECOVERY_WINDOW_MS,
  loadActiveConversations,
} from "./daemon-queue.ts";

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

function sanitizeAttachmentName(name?: string | null): string {
  const safeBase = basename(name || "attachment");
  const sanitized = safeBase.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "attachment";
}

type ChannelNotificationPayload = {
  meta: Record<string, string>;
  cleanContent: string;
};

async function buildChannelNotificationMeta(
  message: Message,
  ctx: AppContext,
  botUserId: string,
  opts: { replyToUserId: string | null; conversationMode: boolean }
): Promise<ChannelNotificationPayload> {
  const userId = message.author.id;
  const isDM = !message.guild;
  const isMentionedHere = !isDM && message.mentions.has(botUserId);
  const isOwner = ctx.ownerUserId
    ? userId === ctx.ownerUserId
    : ctx.allowedUsers.size === 0;

  const meta: Record<string, string> = {
    chat_id: message.channelId,
    message_id: message.id,
    user: message.author.username,
    user_id: userId,
    ts: message.createdAt.toISOString(),
    is_dm: isDM ? "true" : "false",
    role: isOwner ? "owner" : "user",
  };

  if (opts.conversationMode && !isDM && !isMentionedHere) {
    meta.conversation_mode = "true";
  }

  if (opts.replyToUserId) {
    meta.reply_to_user = opts.replyToUserId;
  }

  if (message.attachments.size > 0) {
    meta.attachment_count = String(message.attachments.size);
    const descriptions: string[] = [];
    const filePaths: string[] = [];
    const downloadDir = `${ctx.DATA_DIR}/inbox`;
    await mkdir(downloadDir, { recursive: true });

    for (const [, attachment] of message.attachments) {
      descriptions.push(
        `${attachment.name} (${attachment.contentType || "unknown"}, ${Math.round((attachment.size || 0) / 1024)}KB)`
      );

      try {
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`download failed: ${response.status}`);
        const buffer = await response.arrayBuffer();
        const safeName = sanitizeAttachmentName(attachment.name);
        const filePath = `${downloadDir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
        await Bun.write(filePath, buffer);
        filePaths.push(filePath);
      } catch {
        // Download failed, Claude will just see the description
      }
    }
    meta.attachments = descriptions.join("; ");
    if (filePaths.length > 0) meta.file_path = filePaths[0];
    if (filePaths.length > 1) meta.file_paths = filePaths.join(";");
  }

  const cleanContent = message.content
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
    .trim();

  return { meta, cleanContent };
}

/**
 * After a daemon session cycle, the worker briefly disconnects from Discord.
 * Fetch any messages that arrived in each tracked chat during the gap and
 * forward them as if they were live MessageCreate events.
 *
 * No-op when daemon-state.json is absent (interactive mode), stale, or
 * outside the recovery window.
 */
async function runGapRecovery(ctx: AppContext, botUserId: string): Promise<void> {
  const metaDir = `${ctx.DATA_DIR}/meta`;
  const stateFile = `${metaDir}/daemon-state.json`;

  let daemonState: any;
  try {
    daemonState = JSON.parse(await readFile(stateFile, "utf-8"));
  } catch {
    return; // Interactive mode or first boot — nothing to recover
  }

  if (daemonState.mode !== "daemon") return;

  const lastCycleAt: number | null = daemonState.lastCycleAt ?? null;
  if (!lastCycleAt) return;

  const age = Date.now() - lastCycleAt;
  if (age < 0 || age > GAP_RECOVERY_WINDOW_MS) return;

  const conversations = await loadActiveConversations(metaDir);
  if (conversations.length === 0) return;

  let forwarded = 0;
  let channelsChecked = 0;

  for (const conv of conversations) {
    if (!conv.messageId) continue;
    channelsChecked++;

    try {
      const channel = await ctx.discord.channels.fetch(conv.chatId);
      if (!channel || !channel.isTextBased()) continue;
      if (!("messages" in channel)) continue;

      const fetched = await channel.messages.fetch({
        after: conv.messageId,
        limit: 50,
      });

      // Discord returns newest-first; replay in chronological order
      const chronological = [...fetched.values()].sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      for (const message of chronological) {
        if (message.author.bot) continue;
        if (message.author.id === botUserId) continue;
        if (message.createdTimestamp <= lastCycleAt) continue;

        let replyToUserId: string | null = null;
        if (message.reference?.messageId) {
          try {
            const refMsg = await message.channel.messages.fetch(
              message.reference.messageId
            );
            replyToUserId = refMsg.author.id;
          } catch {}
        }

        const { meta, cleanContent } = await buildChannelNotificationMeta(
          message,
          ctx,
          botUserId,
          { replyToUserId, conversationMode: false }
        );

        ctx.mcp.notification({
          method: "notifications/claude/channel" as any,
          params: {
            content:
              cleanContent ||
              "(empty message — user may have just mentioned you)",
            meta,
          },
        });

        forwarded++;
      }
    } catch (err: any) {
      console.error(
        `Gap recovery: skipping chat ${conv.chatId} — ${err?.message || err}`
      );
    }
  }

  if (forwarded > 0 || channelsChecked > 0) {
    console.error(
      `Gap recovery: forwarded ${forwarded} message(s) from ${channelsChecked} channel(s)`
    );
  }
}

function generatePairingCode(): string {
  const chars = "abcdefghjkmnopqrstuvwxyz"; // no 'i' or 'l'
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function createDiscordClient(ctx: AppContext): Client {
  // Merge core intents with plugin intents
  const pluginIntents = ctx.plugins.flatMap((p) => p.intents ?? []);

  const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      ...pluginIntents,
    ],
    partials: [
      Partials.Channel, // Required for DM support
      Partials.Message,
    ],
  });

  discord.once(Events.ClientReady, async (c) => {
    console.error(`Choomfie Discord: logged in as ${c.user.tag}`);
    ctx.startedAt = Date.now();
    const initDone = () => { (ctx as any)._discordReadyResolve?.(); };

    // Fallback: auto-detect owner if not set during setup
    if (!ctx.ownerUserId) {
      try {
        const app = await c.application.fetch();
        const appOwner = app.owner;
        if (appOwner) {
          ctx.ownerUserId = appOwner.id;
          ctx.allowedUsers.add(appOwner.id);
          await saveAccess(ctx);
          console.error(
            `Choomfie: auto-detected owner from Discord app: ${appOwner.id}`
          );
        }
      } catch {
        console.error(
          "Choomfie: no owner set — run /choomfie:access owner <USER_ID>"
        );
      }
    }

    // Initialize timer-based reminder scheduler
    ctx.reminderScheduler.init(ctx);

    // Start inbox cleanup (every hour, delete files older than 24h)
    const cleanInbox = async () => {
      const inboxDir = `${ctx.DATA_DIR}/inbox`;
      try {
        const files = await readdir(inboxDir);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const file of files) {
          const filePath = `${inboxDir}/${file}`;
          const info = await stat(filePath);
          if (info.mtimeMs < cutoff) {
            await unlink(filePath);
          }
        }
      } catch {
        // inbox dir doesn't exist yet, that's fine
      }
    };
    // Clear previous interval if restarting, then start fresh
    if ((ctx as any)._inboxInterval) clearInterval((ctx as any)._inboxInterval);
    (ctx as any)._inboxInterval = setInterval(cleanInbox, 60 * 60 * 1000);
    cleanInbox(); // Run on startup

    // Initialize plugins
    for (const plugin of ctx.plugins) {
      if (plugin.init) {
        try {
          await plugin.init(ctx);
          console.error(`Plugin initialized: ${plugin.name}`);
        } catch (e) {
          console.error(`Plugin ${plugin.name} init failed: ${e}`);
        }
      }
    }

    // Auto-deploy slash commands if they've changed
    try {
      const commands = getCommandDefs();
      const hash = Bun.hash(JSON.stringify(commands)).toString(36);
      const hashFile = `${ctx.DATA_DIR}/.commands-hash`;
      let lastHash = "";
      try { lastHash = await Bun.file(hashFile).text(); } catch {}

      if (hash !== lastHash.trim()) {
        const { REST, Routes } = await import("discord.js");
        const rest = new REST().setToken(ctx.discord.token!);
        const appId = c.application.id;

        for (const [id, guild] of c.guilds.cache) {
          await rest.put(Routes.applicationGuildCommands(appId, id), {
            body: commands,
          });
        }
        await Bun.write(hashFile, hash);
        console.error(`Slash commands deployed (${commands.length} commands to ${c.guilds.cache.size} guild(s))`);
      }
    } catch (e) {
      console.error(`Slash command auto-deploy failed: ${e}`);
    }

    initDone();

    // Gap recovery — after a daemon session cycle, fetch any Discord
    // messages that arrived while the worker was disconnected. Runs
    // after initDone so worker startup isn't blocked.
    runGapRecovery(ctx, c.user.id).catch((err) => {
      console.error(`Gap recovery failed (continuing): ${err?.message || err}`);
    });
  });

  discord.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    // Plugin message hooks (run before default handler)
    for (const plugin of ctx.plugins) {
      if (plugin.onMessage) {
        try {
          await plugin.onMessage(message, ctx);
        } catch (e) {
          console.error(`Plugin ${plugin.name} onMessage error: ${e}`);
        }
      }
    }

    const userId = message.author.id;
    const isDM = !message.guild;

    // Track message stats
    ctx.messageStats.received++;
    ctx.messageStats.byUser.set(
      userId,
      (ctx.messageStats.byUser.get(userId) || 0) + 1
    );

    // Handle permission replies before anything else (no rate limit)
    const canApprovePermissions = ctx.ownerUserId
      ? userId === ctx.ownerUserId
      : ctx.allowedUsers.has(userId);
    const permMatch = PERMISSION_REPLY_RE.exec(message.content);
    if (permMatch && canApprovePermissions) {
      ctx.mcp.notification({
        method: "notifications/claude/channel/permission" as any,
        params: {
          request_id: permMatch[2].toLowerCase(),
          behavior: permMatch[1].toLowerCase().startsWith("y")
            ? "allow"
            : "deny",
        },
      });
      await message.react("\u2705");
      return;
    }

    // Handle pairing requests (DMs only, no rate limit)
    if (message.content.startsWith("!pair") && isDM) {
      const code = generatePairingCode();
      ctx.pendingPairings.set(code, {
        userId,
        username: message.author.username,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
      });
      await message.reply(
        `Your pairing code is: \`${code}\`\nRun \`/choomfie:access pair ${code}\` in Claude Code within 5 minutes.`
      );
      return;
    }

    // --- Trigger rules ---
    // DMs: always respond
    // Servers: only when @mentioned or replying to the bot
    let replyToUserId: string | null = null;
    if (!isDM) {
      const isMentioned = message.mentions.has(discord.user!.id);
      // Resolve who this message is replying to (if anyone)
      let isReplyToBot = false;
      if (message.reference?.messageId) {
        try {
          const refMsg = await message.channel.messages.fetch(message.reference.messageId);
          replyToUserId = refMsg.author.id;
          isReplyToBot = refMsg.author.id === discord.user!.id;
        } catch {}
      }
      const convoTimeout = ctx.config.getConvoTimeoutMs();
      const channelActive = isChannelActive(
        ctx.activeChannels,
        message.channelId,
        convoTimeout
      );

      if (!isMentioned && !isReplyToBot && !channelActive) return;

      // Activate channel on @mention or reply; refresh on ongoing conversation
      if (isMentioned || isReplyToBot) {
        activateChannel(ctx.activeChannels, message.channelId);
      } else if (channelActive) {
        refreshChannel(ctx.activeChannels, message.channelId);
      }
    }

    // Only forward messages from allowlisted users
    // (bootstrap mode: accept all if no users allowlisted yet)
    // Note: !pair handler above is intentionally before this check
    if (!ctx.allowedUsers.has(userId)) {
      if (ctx.allowedUsers.size > 0) return;
    }

    // Rate limit check
    if (
      isRateLimited(
        ctx.lastMessageTime,
        userId,
        ctx.config.getRateLimitMs()
      )
    )
      return;

    // Decide conversation_mode before building meta
    const conversationMode =
      !isDM &&
      !message.mentions.has(discord.user!.id) &&
      isChannelActive(
        ctx.activeChannels,
        message.channelId,
        ctx.config.getConvoTimeoutMs()
      );

    const { meta, cleanContent } = await buildChannelNotificationMeta(
      message,
      ctx,
      discord.user!.id,
      { replyToUserId, conversationMode }
    );

    // Show typing indicator while Claude processes (state machine in lib/typing.ts)
    const isConversationMode = meta.conversation_mode === "true";
    onMessageReceived(message.channelId, message.channel as any, isConversationMode);

    // Forward to Claude Code
    ctx.mcp.notification({
      method: "notifications/claude/channel" as any,
      params: {
        content:
          cleanContent ||
          "(empty message — user may have just mentioned you)",
        meta,
      },
    });
  });

  // Handle interactions (buttons, slash commands, modals)
  discord.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction, ctx);
  });

  return discord;
}
