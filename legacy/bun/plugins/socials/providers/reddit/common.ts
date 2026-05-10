import type { RedditComment, RedditPost } from "../types.ts";

type RedditThing<T> = {
  kind?: string;
  data?: T;
};

type RedditListing<T> = {
  data?: {
    children?: Array<RedditThing<T>>;
  };
};

type RedditCommentData = {
  author?: string;
  body?: string;
  score?: number;
  created_utc?: number;
};

type RedditPostData = RedditCommentData & {
  title?: string;
  url?: string;
  subreddit?: string;
  num_comments?: number;
  selftext?: string;
  permalink?: string;
};

export function postToResult(data: RedditPostData): RedditPost {
  return {
    title: data.title || "",
    url: data.url || "",
    subreddit: data.subreddit || "",
    author: data.author || "[deleted]",
    score: data.score || 0,
    comments: data.num_comments || 0,
    selftext: data.selftext?.slice(0, 500) || undefined,
    created: new Date((data.created_utc || 0) * 1000).toISOString(),
    permalink: `https://reddit.com${data.permalink || ""}`,
  };
}

export function commentToResult(data: RedditCommentData): RedditComment {
  return {
    author: data.author || "[deleted]",
    body: data.body || "",
    score: data.score || 0,
    created: new Date((data.created_utc || 0) * 1000).toISOString(),
  };
}

export function mapPostChildren(data: RedditListing<RedditPostData> | undefined): RedditPost[] {
  return (data?.data?.children || []).map((child) => postToResult(child.data || {}));
}

export function mapCommentChildren(
  comments: Array<RedditThing<RedditCommentData>>,
  limit: number,
): RedditComment[] {
  return comments
    .filter((child) => child.kind === "t1")
    .slice(0, limit)
    .map((child) => commentToResult(child.data || {}));
}

export function normalizeCommentsUrl(postUrl: string): string {
  let cleanUrl = postUrl.split("?")[0].replace(/\/+$/, "");
  if (!cleanUrl.endsWith(".json")) cleanUrl += ".json";
  return cleanUrl.startsWith("http")
    ? cleanUrl
    : `https://www.reddit.com${cleanUrl}`;
}
