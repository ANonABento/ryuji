import type { Plugin, ToolDef } from "@choomfie/shared";
import { err, registerCommand, text } from "@choomfie/shared";
import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type Client,
  type TextBasedChannel,
} from "discord.js";
import { RssDb, getRssDb, setRssDb, type RssSubscription } from "./db.ts";
import { fetchFeed, type FeedItem } from "./feed.ts";

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const MAX_ITEMS_PER_POLL = 10;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

function itemUrl(item: FeedItem): string {
  return item.link ? `\n${item.link}` : "";
}

function formatItem(feedTitle: string, item: FeedItem): string {
  return `**${feedTitle}**\n${item.title}${itemUrl(item)}`;
}

async function sendToChannel(
  client: Client,
  channelId: string,
  content: string
): Promise<boolean> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !("send" in channel)) return false;
  await (channel as TextBasedChannel).send({ content });
  return true;
}

async function pollFeeds(client: Client, db: RssDb) {
  if (isPolling) return;
  isPolling = true;
  try {
    for (const sub of db.listSubscriptions()) {
      try {
        const feed = await fetchFeed(sub.url);
        const unseen = db.unseenItems(sub.id, feed.items);
        if (unseen.length === 0) continue;

        const toPost = unseen.slice(-MAX_ITEMS_PER_POLL);
        const posted: FeedItem[] = [];
        for (const item of toPost.reverse()) {
          const sent = await sendToChannel(client, sub.channelId, formatItem(feed.title, item));
          if (!sent) break;
          posted.push(item);
        }
        if (posted.length > 0) {
          db.markSeen(sub.id, posted);
        }
      } catch (e) {
        console.error(`RSS: poll failed for subscription ${sub.id}: ${e}`);
      }
    }
  } finally {
    isPolling = false;
  }
}

function buildListEmbed(subscriptions: RssSubscription[]) {
  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle("RSS subscriptions");
  if (subscriptions.length === 0) {
    embed.setDescription("No RSS subscriptions configured.");
    return embed;
  }

  embed.setDescription(
    subscriptions
      .map((sub) => `**#${sub.id}** <#${sub.channelId}> - ${sub.title}\n${sub.url}`)
      .join("\n\n")
      .slice(0, 4000)
  );
  embed.setFooter({ text: `${subscriptions.length} total - /rss unsubscribe id:<id>` });
  return embed;
}

registerCommand("rss", {
  data: new SlashCommandBuilder()
    .setName("rss")
    .setDescription("Manage RSS feed subscriptions")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("subscribe")
        .setDescription("Subscribe a channel to an RSS feed")
        .addStringOption((option) =>
          option.setName("url").setDescription("RSS or Atom feed URL").setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel where new items should be posted")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List RSS subscriptions")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Filter to one channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unsubscribe")
        .setDescription("Remove an RSS subscription")
        .addIntegerOption((option) =>
          option.setName("id").setDescription("Subscription ID from /rss list").setRequired(true)
        )
    )
    .toJSON(),
  handler: async (interaction) => {
    const db = getRssDb();
    if (!db) {
      await interaction.reply({
        content: "RSS plugin is not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const action = interaction.options.getSubcommand();
    if (action === "subscribe") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const url = interaction.options.getString("url", true).trim();
      const channel = interaction.options.getChannel("channel", true);

      let feed;
      try {
        feed = await fetchFeed(url);
      } catch (e) {
        await interaction.editReply(`Could not read that feed: ${e}`);
        return;
      }

      if (feed.items.length === 0) {
        await interaction.editReply("That feed did not contain any items.");
        return;
      }

      try {
        const sub = db.addSubscription({
          url,
          channelId: channel.id,
          guildId: interaction.guildId,
          createdBy: interaction.user.id,
          title: feed.title,
        });
        db.markSeen(sub.id, feed.items);
        await interaction.editReply(
          `Subscribed <#${channel.id}> to **${feed.title}**. Existing items were marked as seen.`
        );
      } catch (e) {
        await interaction.editReply(`Could not subscribe: ${e}`);
      }
      return;
    }

    if (action === "list") {
      const channel = interaction.options.getChannel("channel");
      await interaction.reply({
        embeds: [
          buildListEmbed(
            db.listSubscriptions({ channelId: channel?.id, guildId: interaction.guildId })
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "unsubscribe") {
      const id = interaction.options.getInteger("id", true);
      const deleted = db.deleteSubscription(id, interaction.guildId);
      await interaction.reply({
        content: deleted
          ? `Unsubscribed **#${deleted.id}** from **${deleted.title}**.`
          : `Subscription #${id} not found.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
});

const tools: ToolDef[] = [
  {
    definition: {
      name: "rss_subscriptions",
      description: "List configured RSS feed subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Optional Discord channel ID filter" },
        },
      },
    },
    handler: async (args) => {
      const db = getRssDb();
      if (!db) return err("RSS plugin is not initialized.");
      const channelId = typeof args.channelId === "string" ? args.channelId : undefined;
      const subscriptions = db.listSubscriptions({ channelId });
      if (subscriptions.length === 0) return text("No RSS subscriptions configured.");
      return text(
        subscriptions
          .map((sub) => `#${sub.id} ${sub.title} -> ${sub.channelId}\n${sub.url}`)
          .join("\n\n")
      );
    },
  },
];

const rssPlugin: Plugin = {
  name: "rss",
  tools,
  instructions: [
    "## RSS",
    "Use `/rss subscribe url:<feed-url> channel:<channel>` to subscribe a channel to a feed.",
    "Use `/rss list` and `/rss unsubscribe id:<id>` to manage subscriptions.",
    "New feed items are checked every 15 minutes and posted to the subscribed Discord channel.",
  ],
  userTools: ["rss_subscriptions"],

  async init(ctx) {
    const db = new RssDb(`${ctx.DATA_DIR}/rss.db`);
    setRssDb(db);

    if (!ctx.discord) {
      console.error("RSS: Discord unavailable, polling disabled");
      return;
    }

    await pollFeeds(ctx.discord, db);
    pollInterval = setInterval(() => {
      if (ctx.discord) void pollFeeds(ctx.discord, db);
    }, POLL_INTERVAL_MS);
    console.error("RSS: initialized");
  },

  async destroy() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    const db = getRssDb();
    if (db) {
      db.close();
      setRssDb(null);
    }
  },
};

export default rssPlugin;
export { parseFeed } from "./feed.ts";
