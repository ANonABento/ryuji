/**
 * Social platform tools — YouTube search/info, Reddit browse/search, LinkedIn posting.
 */

import type { ToolDef } from "../../lib/types.ts";
import { text, err } from "../../lib/types.ts";
import { getYouTubeProvider, getRedditProvider } from "./providers/index.ts";
import { LinkedInClient } from "./providers/linkedin/api.ts";

const yt = getYouTubeProvider();
const reddit = getRedditProvider();

/** LinkedIn client — lazily initialized when first tool is called (needs ctx.DATA_DIR + config) */
let linkedInClient: LinkedInClient | null = null;

function getLinkedInClient(ctx: { DATA_DIR: string; config: any }): LinkedInClient {
  if (linkedInClient) return linkedInClient;

  const config = ctx.config.getConfig();
  const socialsConfig = (config as any).socials?.linkedin;

  if (!socialsConfig?.clientId || !socialsConfig?.clientSecret) {
    throw new Error(
      "LinkedIn not configured. Add socials.linkedin.clientId and socials.linkedin.clientSecret to config.json. " +
      "Create a LinkedIn app at https://developer.linkedin.com first."
    );
  }

  linkedInClient = new LinkedInClient(
    ctx.DATA_DIR,
    socialsConfig.clientId,
    socialsConfig.clientSecret
  );
  return linkedInClient;
}

/** Called on plugin destroy to clean up LinkedIn client */
export function destroyLinkedInClient(): void {
  linkedInClient?.destroy();
  linkedInClient = null;
}

export const socialsTools: ToolDef[] = [
  // --- YouTube ---
  {
    definition: {
      name: "youtube_search",
      description:
        "Search YouTube for videos. Returns titles, URLs, channels, and durations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["query"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const results = await yt.search(
          args.query as string,
          (args.limit as number) || 5
        );
        if (results.length === 0) return text("No results found.");

        const formatted = results
          .map(
            (v, i) =>
              `**${i + 1}.** ${v.title}\n  ${v.url}\n  ${v.channel} · ${v.duration}${v.views ? ` · ${v.views} views` : ""}`
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`YouTube search failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_info",
      description: "Get detailed info about a YouTube video.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "YouTube video URL" },
        },
        required: ["url"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const info = await yt.getInfo(args.url as string);
        if (!info) return err("Video not found.");
        return text(
          [
            `**${info.title}**`,
            `Channel: ${info.channel}`,
            `Duration: ${info.duration}`,
            info.views ? `Views: ${info.views}` : null,
            info.published ? `Published: ${info.published}` : null,
            `URL: ${info.url}`,
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (e: any) {
        return err(`YouTube info failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "youtube_transcript",
      description: "Get the transcript/captions of a YouTube video.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "YouTube video URL" },
        },
        required: ["url"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const segments = await yt.getTranscript(args.url as string);
        if (segments.length === 0)
          return text("No transcript available for this video.");
        const transcript = segments.map((s) => s.text).join(" ");
        // Truncate if too long
        return text(
          transcript.length > 3000
            ? transcript.slice(0, 3000) + "\n\n...(truncated)"
            : transcript
        );
      } catch (e: any) {
        return err(`Transcript failed: ${e.message}`);
      }
    },
  },

  // --- Reddit ---
  {
    definition: {
      name: "reddit_search",
      description:
        "Search Reddit for posts. Can search all of Reddit or a specific subreddit.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          subreddit: {
            type: "string",
            description: "Subreddit to search in (optional)",
          },
          limit: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["query"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const results = await reddit.search(
          args.query as string,
          args.subreddit as string | undefined,
          (args.limit as number) || 5
        );
        if (results.length === 0) return text("No posts found.");

        const formatted = results
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.title}\n  r/${p.subreddit} · ${p.score} pts · ${p.comments} comments\n  ${p.permalink}`
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`Reddit search failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "reddit_posts",
      description: "Get posts from a subreddit (hot, top, or new).",
      inputSchema: {
        type: "object" as const,
        properties: {
          subreddit: { type: "string", description: "Subreddit name (without r/)" },
          sort: {
            type: "string",
            enum: ["hot", "top", "new"],
            description: "Sort order (default: hot)",
          },
          limit: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["subreddit"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const posts = await reddit.getPosts(
          args.subreddit as string,
          (args.sort as "hot" | "top" | "new") || "hot",
          (args.limit as number) || 5
        );
        if (posts.length === 0) return text("No posts found.");

        const formatted = posts
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.title}\n  ${p.score} pts · ${p.comments} comments · u/${p.author}\n  ${p.permalink}`
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`Reddit posts failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "reddit_comments",
      description: "Get top comments on a Reddit post.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "Reddit post URL or permalink" },
          limit: { type: "number", description: "Max comments (default: 5)" },
        },
        required: ["url"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const comments = await reddit.getComments(
          args.url as string,
          (args.limit as number) || 5
        );
        if (comments.length === 0) return text("No comments found.");

        const formatted = comments
          .map(
            (c, i) =>
              `**${i + 1}.** u/${c.author} (${c.score} pts)\n  ${c.body.slice(0, 300)}${c.body.length > 300 ? "..." : ""}`
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`Reddit comments failed: ${e.message}`);
      }
    },
  },

  // --- LinkedIn ---
  {
    definition: {
      name: "linkedin_auth",
      description:
        "Start LinkedIn OAuth flow. Returns an authorization URL the user must visit to connect their LinkedIn account. " +
        "A temporary local server catches the callback automatically.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const { authUrl, port } = await client.startAuth();
        return text(
          `**LinkedIn Authorization**\n\n` +
          `Click the link below to connect your LinkedIn account:\n${authUrl}\n\n` +
          `A temporary callback server is running on port ${port}. ` +
          `It will automatically capture the authorization and shut down.\n` +
          `The link expires in 5 minutes.`
        );
      } catch (e: any) {
        return err(`LinkedIn auth failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_post",
      description:
        "Post text content to the authenticated user's LinkedIn personal profile.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The post content (text). LinkedIn supports up to 3000 characters.",
          },
        },
        required: ["text"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const postText = args.text as string;

        if (postText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }

        const result = await client.post(postText);
        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Posted to LinkedIn successfully.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_status",
      description:
        "Check LinkedIn authentication status — whether connected, who is connected, and token expiry.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const status = client.getStatus();

        if (!status.authenticated) {
          return text("LinkedIn: **Not connected**. Use `linkedin_auth` to connect.");
        }

        const expiresIn = status.expiresAt
          ? Math.max(0, Math.round((status.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
          : "unknown";

        return text(
          `LinkedIn: **Connected**\n` +
          `Name: ${status.name || "Unknown"}\n` +
          `URN: ${status.personUrn || "Unknown"}\n` +
          `Token expires in: ~${expiresIn} days`
        );
      } catch (e: any) {
        return err(`LinkedIn status check failed: ${e.message}`);
      }
    },
  },
];
