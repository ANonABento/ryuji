import type { ToolDef } from "@choomfie/shared";
import { err, text } from "@choomfie/shared";
import {
  getRedditClient,
  getRedditProvider,
} from "../providers/index.ts";
import type { RedditClient } from "../providers/reddit/api.ts";

const reddit = getRedditProvider();

function getRedditWriteClient(): RedditClient | null {
  return getRedditClient();
}

export const redditTools: ToolDef[] = [
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
          (args.limit as number) || 5,
        );
        if (results.length === 0) return text("No posts found.");

        const formatted = results
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.title}\n  r/${p.subreddit} · ${p.score} pts · ${p.comments} comments\n  ${p.permalink}`,
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
          subreddit: {
            type: "string",
            description: "Subreddit name (without r/)",
          },
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
          (args.limit as number) || 5,
        );
        if (posts.length === 0) return text("No posts found.");

        const formatted = posts
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.title}\n  ${p.score} pts · ${p.comments} comments · u/${p.author}\n  ${p.permalink}`,
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
          (args.limit as number) || 5,
        );
        if (comments.length === 0) return text("No comments found.");

        const formatted = comments
          .map(
            (c, i) =>
              `**${i + 1}.** u/${c.author} (${c.score} pts)\n  ${c.body.slice(0, 300)}${c.body.length > 300 ? "..." : ""}`,
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`Reddit comments failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "reddit_auth",
      description:
        "Check Reddit API authentication status. Reddit uses OAuth password grant — " +
        "auto-authenticates from config. Shows connection status, username, and token expiry.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, _ctx) => {
      try {
        const client = getRedditWriteClient();
        if (!client) {
          return text(
            "Reddit: **Not configured**\n\n" +
              "Add Reddit credentials to config.json:\n" +
              '```json\n"socials": {\n  "reddit": {\n    "clientId": "...",\n    "clientSecret": "...",\n    "username": "...",\n    "password": "..."\n  }\n}\n```\n' +
              "Create a script app at https://www.reddit.com/prefs/apps",
          );
        }

        const status = await client.getAuthStatus();
        if (!status.authenticated) {
          return text(
            `Reddit: **Auth failed** for u/${status.username}\n` +
              "Check your credentials in config.json.",
          );
        }

        const expiresIn = status.expiresAt
          ? Math.max(0, Math.round((status.expiresAt - Date.now()) / (1000 * 60)))
          : "unknown";

        return text(
          `Reddit: **Connected**\n` +
            `Username: u/${status.username}\n` +
            `Token expires in: ~${expiresIn} minutes (auto-refreshes)`,
        );
      } catch (e: any) {
        return err(`Reddit auth check failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "reddit_post",
      description:
        "Submit a post to a subreddit. Supports text, link, and image posts. Owner only. " +
        "Returns the post URL on success.",
      inputSchema: {
        type: "object" as const,
        properties: {
          subreddit: {
            type: "string",
            description: "Subreddit to post to (without r/)",
          },
          title: { type: "string", description: "Post title" },
          text: {
            type: "string",
            description: "Post body text (markdown supported)",
          },
          kind: {
            type: "string",
            enum: ["self", "link", "image"],
            description:
              "Post type: 'self' for text (default), 'link' for link, 'image' for image post",
          },
          url: {
            type: "string",
            description: "URL for link posts (required when kind=link)",
          },
          image: {
            type: "string",
            description:
              "Absolute file path to image for image posts (PNG/JPG/GIF, required when kind=image)",
          },
        },
        required: ["subreddit", "title"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const client = getRedditWriteClient();
        if (!client) {
          return err("Reddit not configured. Add socials.reddit config to config.json.");
        }

        const subreddit = args.subreddit as string;
        const title = args.title as string;
        const kind = (args.kind as string) || "self";

        let result;
        if (kind === "image") {
          const imagePath = args.image as string;
          if (!imagePath) return err("Image path is required for image posts.");
          const postText = (args.text as string) || undefined;
          result = await client.submitImage(subreddit, title, imagePath, postText);
        } else if (kind === "link") {
          const url = args.url as string;
          if (!url) return err("URL is required for link posts.");
          result = await client.submitLink(subreddit, title, url);
        } else {
          const postText = (args.text as string) || "";
          result = await client.submitPost(subreddit, title, postText);
        }

        return text(
          `Posted to r/${subreddit} successfully.\n` +
            `Post ID: ${result.fullname}\n` +
            `URL: ${result.url}`,
        );
      } catch (e: any) {
        return err(`Reddit post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "reddit_comment",
      description:
        "Comment on a Reddit post or reply to a comment. Owner only. " +
        "Use the post's fullname (t3_xxx) or a comment's fullname (t1_xxx) as the parent.",
      inputSchema: {
        type: "object" as const,
        properties: {
          parent: {
            type: "string",
            description:
              "Fullname of the post (t3_xxx) or comment (t1_xxx) to reply to",
          },
          text: {
            type: "string",
            description: "Comment text (markdown supported)",
          },
        },
        required: ["parent", "text"],
      },
    },
    handler: async (args, _ctx) => {
      try {
        const client = getRedditWriteClient();
        if (!client) {
          return err("Reddit not configured. Add socials.reddit config to config.json.");
        }

        const parent = args.parent as string;
        const commentText = args.text as string;

        if (!/^t[13]_[a-z0-9]+$/i.test(parent)) {
          return err(
            "Invalid parent fullname. Must be t3_xxx (post) or t1_xxx (comment).",
          );
        }

        const result = await client.comment(parent, commentText);
        return text(
          `Comment posted successfully.\n` +
            `Comment ID: ${result.fullname}`,
        );
      } catch (e: any) {
        return err(`Reddit comment failed: ${e.message}`);
      }
    },
  },
];
