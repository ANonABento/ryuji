/**
 * Socials plugin — YouTube + Reddit + LinkedIn integration.
 *
 * Provider pattern with auto-fallback:
 *   YouTube: yt-dlp (primary) → YouTube Data API (fallback)
 *   Reddit: Official API via snoowrap (primary) → JSON scraper (fallback)
 *   LinkedIn: OAuth 2.0 + PKCE, raw fetch against REST API
 *
 * Future: Twitter/X, Bluesky
 */

import type { Plugin } from "../../lib/types.ts";
import { socialsTools, destroyLinkedInClient } from "./tools.ts";

const socialsPlugin: Plugin = {
  name: "socials",

  tools: socialsTools,

  instructions: [
    "## Social Platforms",
    "You can search and browse YouTube and Reddit, and post to LinkedIn.",
    "",
    "**YouTube:**",
    "- `youtube_search` — search for videos",
    "- `youtube_info` — get video details",
    "- `youtube_transcript` — get video captions/transcript",
    "",
    "**Reddit:**",
    "- `reddit_search` — search posts (optionally in a specific subreddit)",
    "- `reddit_posts` — browse a subreddit (hot/top/new)",
    "- `reddit_comments` — read comments on a post",
    "",
    "**LinkedIn:**",
    "- `linkedin_auth` — connect a LinkedIn account (OAuth, owner only)",
    "- `linkedin_post` — post text to the connected LinkedIn profile",
    "- `linkedin_status` — check if LinkedIn is connected and token status",
    "",
    "LinkedIn requires setup: create an app at developer.linkedin.com, add client ID/secret to config.json under socials.linkedin.",
    "",
    "When sharing YouTube links, post the full URL so Discord auto-embeds the video.",
  ],

  userTools: [
    "youtube_search",
    "youtube_info",
    "youtube_transcript",
    "reddit_search",
    "reddit_posts",
    "reddit_comments",
    // LinkedIn tools are owner-only (not listed here)
  ],

  async destroy() {
    destroyLinkedInClient();
  },
};

export default socialsPlugin;
