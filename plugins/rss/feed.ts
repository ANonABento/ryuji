import { createHash } from "node:crypto";

export interface FeedItem {
  id: string;
  title: string;
  link?: string;
  publishedAt?: string;
}

export interface ParsedFeed {
  title: string;
  items: FeedItem[];
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .trim();
}

function firstTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

function attr(xml: string, tag: string, name: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*\\s${name}=["']([^"']+)["'][^>]*>`, "i").exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"))].map(
    (match) => match[0]
  );
}

function stableId(title: string, link?: string, publishedAt?: string): string {
  return createHash("sha256")
    .update(`${title}\n${link ?? ""}\n${publishedAt ?? ""}`)
    .digest("hex");
}

function parseRssItem(xml: string): FeedItem | null {
  const title = firstTag(xml, "title") || "(untitled)";
  const link = firstTag(xml, "link") || firstTag(xml, "guid");
  const publishedAt = firstTag(xml, "pubDate") || firstTag(xml, "dc:date");
  const guid = firstTag(xml, "guid") || link || stableId(title, link, publishedAt);
  return { id: guid, title, link, publishedAt };
}

function parseAtomEntry(xml: string): FeedItem | null {
  const title = firstTag(xml, "title") || "(untitled)";
  const link = attr(xml, "link", "href") || firstTag(xml, "link");
  const publishedAt = firstTag(xml, "published") || firstTag(xml, "updated");
  const id = firstTag(xml, "id") || link || stableId(title, link, publishedAt);
  return { id, title, link, publishedAt };
}

export function parseFeed(xml: string): ParsedFeed {
  const rssItems = blocks(xml, "item").map(parseRssItem).filter((item): item is FeedItem => !!item);
  const atomItems = blocks(xml, "entry").map(parseAtomEntry).filter((item): item is FeedItem => !!item);
  const items = rssItems.length > 0 ? rssItems : atomItems;
  const title = firstTag(firstTag(xml, "channel") ?? xml, "title") || firstTag(xml, "title") || "RSS Feed";

  return { title, items };
}

export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "user-agent": "Choomfie RSS Reader",
    },
  });

  if (!response.ok) {
    throw new Error(`Feed returned ${response.status}`);
  }

  return parseFeed(await response.text());
}
