/**
 * Socials plugin — YouTube + Reddit + LinkedIn integration.
 *
 * Provider pattern with auto-fallback:
 *   YouTube: yt-dlp (primary) → YouTube Data API (fallback)
 *   Reddit: OAuth API client (primary) → JSON scraper (fallback)
 *   LinkedIn: OAuth 2.0 (standard 3-legged), Posts API (/rest/posts)
 *
 * Future: Twitter/X, Bluesky
 */

import type { Plugin } from "../../lib/types.ts";
import { socialsTools, destroyLinkedInClient } from "./tools.ts";
import {
  initRedditProvider,
  destroyRedditClient,
  initYouTubeProvider,
  destroyYouTubeCommentClient,
} from "./providers/index.ts";

const socialsPlugin: Plugin = {
  name: "socials",

  tools: socialsTools,

  instructions: [
    "## Social Platforms",
    "You can search and browse YouTube and Reddit, post to Reddit and LinkedIn.",
    "",
    "**YouTube:**",
    "- `youtube_search` — search for videos",
    "- `youtube_info` — get video details",
    "- `youtube_transcript` — get video captions/transcript",
    "- `youtube_comment` — post a comment on a video (owner only, requires YouTube OAuth)",
    "- `youtube_auth` — connect YouTube account for commenting (owner only)",
    "",
    "YouTube read tools work via yt-dlp (no config needed). Comment posting requires OAuth config in config.json under socials.youtube (clientId, clientSecret).",
    "Create a Google Cloud project with YouTube Data API v3 at https://console.cloud.google.com",
    "",
    "**Reddit (read):**",
    "- `reddit_search` — search posts (optionally in a specific subreddit)",
    "- `reddit_posts` — browse a subreddit (hot/top/new)",
    "- `reddit_comments` — read comments on a post",
    "",
    "**Reddit (write — owner only, requires config):**",
    "- `reddit_auth` — check Reddit authentication status",
    "- `reddit_post` — submit a text or link post to a subreddit",
    "- `reddit_comment` — comment on a post or reply to a comment",
    "",
    "Reddit write tools need OAuth config in config.json under socials.reddit (clientId, clientSecret, username, password).",
    "Create a 'script' type app at https://www.reddit.com/prefs/apps",
    "",
    "**LinkedIn:**",
    "- `linkedin_auth` — connect a LinkedIn account (OAuth, owner only)",
    "- `linkedin_post` — post text to the connected LinkedIn profile",
    "- `linkedin_post_image` — post with a single image (URL or file path)",
    "- `linkedin_post_images` — post with multiple images (2-20)",
    "- `linkedin_post_link` — post with a link/article card",
    "- `linkedin_delete` — delete a post by URN (owner only)",
    "- `linkedin_comments` — read comments on a post",
    "- `linkedin_comment` — comment on a post (owner only)",
    "- `linkedin_react` — react to a post (like/celebrate/support/love/insightful/funny)",
    "- `linkedin_status` — check if LinkedIn is connected and token status",
    "",
    "LinkedIn setup: create an app at developer.linkedin.com, enable 'Share on LinkedIn' + 'Sign In with LinkedIn using OpenID Connect' products, add redirect URL `http://localhost:9876/callback` in Auth tab, add client ID/secret to config.json under socials.linkedin.",
    "LinkedIn auth link must be opened on the same machine running Choomfie (localhost callback). Uses standard OAuth, not PKCE.",
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
    // Reddit write tools + LinkedIn tools are owner-only (not listed here)
  ],

  async init(ctx) {
    // Initialize YouTube API key + OAuth comment client from config (if configured)
    initYouTubeProvider({ DATA_DIR: ctx.DATA_DIR, config: ctx.config });
    // Initialize Reddit OAuth client from config (if configured)
    initRedditProvider({ DATA_DIR: ctx.DATA_DIR, config: ctx.config });
  },

  async destroy() {
    destroyLinkedInClient();
    destroyRedditClient();
    destroyYouTubeCommentClient();
  },
};

export default socialsPlugin;
