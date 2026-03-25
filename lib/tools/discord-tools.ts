/**
 * Discord tools — reply, react, edit, fetch, search messages, threads, pin/unpin.
 */

import { ChannelType, type TextChannel, type ThreadChannel } from "discord.js";
import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";

export const discordTools: ToolDef[] = [
  {
    definition: {
      name: "reply",
      description:
        "Reply to a Discord message. Pass chat_id from the inbound message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string", description: "Discord channel ID" },
          text: {
            type: "string",
            description: "Message text (markdown OK)",
          },
          reply_to: {
            type: "string",
            description:
              "Message ID to thread under (omit for normal reply)",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Absolute file paths to attach",
          },
        },
        required: ["chat_id", "text"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased())
        return err("Channel not found or not text-based");

      const textChannel = channel as TextChannel | ThreadChannel;
      const opts: Record<string, unknown> = { content: args.text as string };

      if (args.reply_to) {
        try {
          const replyMsg = await textChannel.messages.fetch(
            args.reply_to as string
          );
          opts.reply = { messageReference: replyMsg };
        } catch {
          // Message not found, send as normal
        }
      }

      if (args.files && Array.isArray(args.files)) {
        opts.files = (args.files as string[]).map((f) => ({
          attachment: f,
        }));
      }

      const sent = await textChannel.send(opts as any);
      ctx.messageStats.sent++;
      return text(`sent (id: ${sent.id})`);
    },
  },
  {
    definition: {
      name: "react",
      description: "Add an emoji reaction to a Discord message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string" },
          message_id: { type: "string" },
          emoji: {
            type: "string",
            description: 'Emoji character or name (e.g. "\ud83d\udc4d")',
          },
        },
        required: ["chat_id", "message_id", "emoji"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");
      const msg = await (channel as TextChannel).messages.fetch(
        args.message_id as string
      );
      await msg.react(args.emoji as string);
      return text("reacted");
    },
  },
  {
    definition: {
      name: "edit_message",
      description: "Edit a previously sent bot message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string" },
          message_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["chat_id", "message_id", "text"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");
      const msg = await (channel as TextChannel).messages.fetch(
        args.message_id as string
      );
      await msg.edit(args.text as string);
      return text("edited");
    },
  },
  {
    definition: {
      name: "fetch_messages",
      description:
        "Fetch recent messages from a Discord channel with optional filters.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string" },
          limit: {
            type: "number",
            description: "Number of messages (default 20, max 100)",
          },
          before: {
            type: "string",
            description: "Fetch messages before this message ID",
          },
          after: {
            type: "string",
            description: "Fetch messages after this message ID",
          },
          user_id: {
            type: "string",
            description:
              "Filter to only show messages from this user ID",
          },
        },
        required: ["chat_id"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");
      const limit = Math.min((args.limit as number) || 20, 100);
      const fetchOpts: Record<string, unknown> = { limit };
      if (args.before) fetchOpts.before = args.before as string;
      if (args.after) fetchOpts.after = args.after as string;

      let messages = await (channel as TextChannel).messages.fetch(
        fetchOpts
      );

      if (args.user_id) {
        messages = messages.filter(
          (m) => m.author.id === (args.user_id as string)
        );
      }

      const formatted = messages
        .reverse()
        .map(
          (m) =>
            `[${m.author.username} ${m.createdAt.toISOString()}] ${m.content}`
        )
        .join("\n");
      return text(formatted || "(no messages matching filters)");
    },
  },
  {
    definition: {
      name: "search_messages",
      description:
        "Search channel history for messages by user, keyword, or both. Paginates through up to 500 messages.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "Channel ID to search",
          },
          user_id: {
            type: "string",
            description: "Filter by Discord user ID",
          },
          keyword: {
            type: "string",
            description:
              "Search for messages containing this text (case-insensitive)",
          },
          max_results: {
            type: "number",
            description: "Max results to return (default 10, max 50)",
          },
          max_scan: {
            type: "number",
            description:
              "Max messages to scan (default 500, max 1000)",
          },
        },
        required: ["chat_id"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");

      const maxResults = Math.min(
        (args.max_results as number) || 10,
        50
      );
      const maxScan = Math.min(
        (args.max_scan as number) || 500,
        1000
      );
      const userId = args.user_id as string | undefined;
      const keyword = (
        args.keyword as string | undefined
      )?.toLowerCase();

      const results: string[] = [];
      let lastId: string | undefined;
      let scanned = 0;

      while (results.length < maxResults && scanned < maxScan) {
        const fetchOpts: Record<string, unknown> = { limit: 100 };
        if (lastId) fetchOpts.before = lastId;

        const batch = await (channel as TextChannel).messages.fetch(
          fetchOpts
        );
        if (batch.size === 0) break;

        for (const [, msg] of batch) {
          scanned++;
          const matchesUser = !userId || msg.author.id === userId;
          const matchesKeyword =
            !keyword ||
            msg.content.toLowerCase().includes(keyword);

          if (matchesUser && matchesKeyword) {
            results.push(
              `[${msg.author.username} ${msg.createdAt.toISOString()}] ${msg.content}`
            );
            if (results.length >= maxResults) break;
          }
        }

        lastId = batch.last()?.id;
      }

      if (results.length === 0) {
        return text(
          `No messages found (scanned ${scanned} messages).`
        );
      }
      return text(
        `Found ${results.length} messages (scanned ${scanned}):\n${results.join("\n")}`
      );
    },
  },
  {
    definition: {
      name: "create_thread",
      description:
        "Create a Discord thread from a message for long conversations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "Channel ID",
          },
          message_id: {
            type: "string",
            description: "Message ID to start the thread from",
          },
          name: {
            type: "string",
            description: "Thread name (max 100 chars)",
          },
        },
        required: ["chat_id", "message_id", "name"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (
        !channel?.isTextBased() ||
        channel.type !== ChannelType.GuildText
      ) {
        return err("Channel not found or not a text channel");
      }
      const msg = await (channel as TextChannel).messages.fetch(
        args.message_id as string
      );
      const thread = await msg.startThread({
        name: (args.name as string).slice(0, 100),
      });
      return text(
        `Thread created: ${thread.name} (id: ${thread.id})`
      );
    },
  },
  {
    definition: {
      name: "pin_message",
      description: "Pin a message in a Discord channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["chat_id", "message_id"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");
      const msg = await (channel as TextChannel).messages.fetch(
        args.message_id as string
      );
      await msg.pin();
      return text("pinned");
    },
  },
  {
    definition: {
      name: "unpin_message",
      description: "Unpin a message in a Discord channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string" },
          message_id: { type: "string" },
        },
        required: ["chat_id", "message_id"],
      },
    },
    handler: async (args, ctx) => {
      const channel = await ctx.discord.channels.fetch(
        args.chat_id as string
      );
      if (!channel?.isTextBased()) return err("Channel not found");
      const msg = await (channel as TextChannel).messages.fetch(
        args.message_id as string
      );
      await msg.unpin();
      return text("unpinned");
    },
  },
];
