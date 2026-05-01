import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RssDb } from "../../../plugins/rss/db.ts";
import { parseFeed } from "../../../plugins/rss/feed.ts";
import { pollFeeds } from "../../../plugins/rss/index.ts";

type PollChannel = {
  send: (payload: { content: string }) => Promise<void>;
};

type PollClient = {
  channels: {
    fetch: (channelId: string) => Promise<PollChannel | null>;
  };
};

function createMockPollClient(targetChannelId: string, sent: string[]): PollClient {
  return {
    channels: {
      fetch: async (channelId: string) =>
        channelId === targetChannelId
          ? {
              send: async ({ content }) => {
                sent.push(content);
              },
            }
          : null,
    },
  };
}

test("parseFeed reads RSS channel title and items", () => {
  const feed = parseFeed(`
    <rss version="2.0">
      <channel>
        <title>Example &amp; News</title>
        <item>
          <title><![CDATA[First item]]></title>
          <link>https://example.com/first</link>
          <guid>first-guid</guid>
          <pubDate>Thu, 30 Apr 2026 12:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
  `);

  expect(feed.title).toBe("Example & News");
  expect(feed.items).toHaveLength(1);
  expect(feed.items[0]).toEqual({
    id: "first-guid",
    title: "First item",
    link: "https://example.com/first",
    publishedAt: "Thu, 30 Apr 2026 12:00:00 GMT",
  });
});

test("parseFeed reads Atom entries", () => {
  const feed = parseFeed(`
    <feed>
      <title>Atom Feed</title>
      <entry>
        <id>tag:example.com,2026:1</id>
        <title>Atom item</title>
        <link href="https://example.com/atom" />
        <updated>2026-04-30T12:00:00Z</updated>
      </entry>
    </feed>
  `);

  expect(feed.title).toBe("Atom Feed");
  expect(feed.items[0]).toEqual({
    id: "tag:example.com,2026:1",
    title: "Atom item",
    link: "https://example.com/atom",
    publishedAt: "2026-04-30T12:00:00Z",
  });
});

test("RssDb stores subscriptions and tracks seen items", () => {
  const dir = mkdtempSync(join(tmpdir(), "choomfie-rss-"));
  const db = new RssDb(join(dir, "rss.db"));

  try {
    const sub = db.addSubscription({
      url: "https://example.com/feed.xml",
      channelId: "123",
      guildId: "456",
      createdBy: "789",
      title: "Example",
    });

    const items = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ];

    expect(db.listSubscriptions()).toEqual([sub]);
    expect(db.unseenItems(sub.id, items)).toEqual(items);

    db.markSeen(sub.id, [items[0]]);
    expect(db.unseenItems(sub.id, items)).toEqual([items[1]]);

    expect(db.deleteSubscription(sub.id)).toEqual(sub);
    expect(db.listSubscriptions()).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pollFeeds posts newest unseen batch in chronological order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "choomfie-rss-"));
  const db = new RssDb(join(dir, "rss.db"));
  const sent: string[] = [];
  const client = createMockPollClient("123", sent);

  const server = Bun.serve({
    port: 0,
    fetch() {
      const items = Array.from({ length: 12 }, (_, index) => {
        const id = 12 - index;
        return `
          <item>
            <title>Item ${id}</title>
            <link>https://example.com/${id}</link>
            <guid>guid-${id}</guid>
          </item>
        `;
      }).join("");

      return new Response(
        `<rss version="2.0"><channel><title>Example</title>${items}</channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } }
      );
    },
  });

  try {
    db.addSubscription({
      url: server.url.toString(),
      channelId: "123",
      guildId: "456",
      createdBy: "789",
      title: "Example",
    });

    await pollFeeds(client, db);

    expect(sent.map((message) => message.match(/Item \d+/)?.[0])).toEqual([
      "Item 3",
      "Item 4",
      "Item 5",
      "Item 6",
      "Item 7",
      "Item 8",
      "Item 9",
      "Item 10",
      "Item 11",
      "Item 12",
    ]);
  } finally {
    server.stop(true);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pollFeeds orders unseen items by publication date when feed order is oldest-first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "choomfie-rss-"));
  const db = new RssDb(join(dir, "rss.db"));
  const sent: string[] = [];
  const client = createMockPollClient("123", sent);

  const server = Bun.serve({
    port: 0,
    fetch() {
      const items = `
        <item>
          <title>Item Old</title>
          <link>https://example.com/old</link>
          <guid>old</guid>
          <pubDate>2026-01-01T00:00:00Z</pubDate>
        </item>
        <item>
          <title>Item Middle</title>
          <link>https://example.com/middle</link>
          <guid>middle</guid>
          <pubDate>2026-01-03T00:00:00Z</pubDate>
        </item>
        <item>
          <title>Item New</title>
          <link>https://example.com/new</link>
          <guid>new</guid>
          <pubDate>2026-01-02T00:00:00Z</pubDate>
        </item>
      `;

      return new Response(
        `<rss version="2.0"><channel><title>Example</title>${items}</channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } }
      );
    },
  });

  try {
    db.addSubscription({
      url: server.url.toString(),
      channelId: "123",
      guildId: "456",
      createdBy: "789",
      title: "Example",
    });

    await pollFeeds(client, db);

    expect(sent.map((message) => message.match(/Item [A-Za-z]+/)?.[0])).toEqual([
      "Item Old",
      "Item New",
      "Item Middle",
    ]);
  } finally {
    server.stop(true);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
