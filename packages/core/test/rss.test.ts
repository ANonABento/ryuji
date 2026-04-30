import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RssDb } from "../../../plugins/rss/db.ts";
import { parseFeed } from "../../../plugins/rss/feed.ts";

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
