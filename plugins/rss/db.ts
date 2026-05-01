import { Database } from "bun:sqlite";
import type { FeedItem } from "./feed.ts";

export interface RssSubscription {
  id: number;
  url: string;
  channelId: string;
  guildId: string | null;
  createdBy: string;
  title: string;
  createdAt: number;
}

interface SubscriptionRow {
  id: number;
  url: string;
  channel_id: string;
  guild_id: string | null;
  created_by: string;
  title: string;
  created_at: number;
}

function mapSubscription(row: SubscriptionRow): RssSubscription {
  return {
    id: row.id,
    url: row.url,
    channelId: row.channel_id,
    guildId: row.guild_id,
    createdBy: row.created_by,
    title: row.title,
    createdAt: row.created_at,
  };
}

export class RssDb {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS rss_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        guild_id TEXT,
        created_by TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(url, channel_id)
      );

      CREATE TABLE IF NOT EXISTS rss_seen_items (
        subscription_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY(subscription_id, item_id),
        FOREIGN KEY(subscription_id) REFERENCES rss_subscriptions(id) ON DELETE CASCADE
      );
    `);
  }

  addSubscription(input: {
    url: string;
    channelId: string;
    guildId: string | null;
    createdBy: string;
    title: string;
  }): RssSubscription {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO rss_subscriptions (url, channel_id, guild_id, created_by, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.url, input.channelId, input.guildId, input.createdBy, input.title, now);
    const id = Number(this.db.query("SELECT last_insert_rowid() AS id").get().id);
    return {
      id,
      url: input.url,
      channelId: input.channelId,
      guildId: input.guildId,
      createdBy: input.createdBy,
      title: input.title,
      createdAt: now,
    };
  }

  listSubscriptions(filters: { channelId?: string; guildId?: string | null } = {}): RssSubscription[] {
    const clauses: string[] = [];
    const params: Array<string | null> = [];

    if (filters.channelId) {
      clauses.push("channel_id = ?");
      params.push(filters.channelId);
    }
    if (filters.guildId !== undefined) {
      clauses.push("guild_id IS ?");
      params.push(filters.guildId);
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .query(`SELECT * FROM rss_subscriptions${where} ORDER BY id`)
      .all(...params);
    return (rows as SubscriptionRow[]).map(mapSubscription);
  }

  deleteSubscription(id: number, guildId?: string | null): RssSubscription | null {
    const guildClause = guildId === undefined ? "" : " AND guild_id IS ?";
    const params = guildId === undefined ? [id] : [id, guildId];
    const row = this.db
      .query(`SELECT * FROM rss_subscriptions WHERE id = ?${guildClause}`)
      .get(...params) as SubscriptionRow | null;
    if (!row) return null;
    this.db.query("DELETE FROM rss_subscriptions WHERE id = ?").run(id);
    return mapSubscription(row);
  }

  markSeen(subscriptionId: number, items: FeedItem[]) {
    const query = this.db.query(
      `INSERT OR IGNORE INTO rss_seen_items (subscription_id, item_id, seen_at)
       VALUES (?, ?, ?)`
    );
    const now = Date.now();
    this.db.transaction(() => {
      for (const item of items) {
        query.run(subscriptionId, item.id, now);
      }
    })();
  }

  unseenItems(subscriptionId: number, items: FeedItem[]): FeedItem[] {
    const query = this.db.query(
      "SELECT 1 FROM rss_seen_items WHERE subscription_id = ? AND item_id = ?"
    );
    return items.filter((item) => !query.get(subscriptionId, item.id));
  }

  close() {
    this.db.close();
  }
}

let rssDb: RssDb | null = null;

export function setRssDb(db: RssDb | null) {
  rssDb = db;
}

export function getRssDb(): RssDb | null {
  return rssDb;
}
