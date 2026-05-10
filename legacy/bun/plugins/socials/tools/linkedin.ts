import type { PluginContext, ToolDef } from "@choomfie/shared";
import {
  dateToSQLite,
  err,
  parseNaturalTime,
  text,
} from "@choomfie/shared";
import { LinkedInClient } from "../providers/linkedin/api.ts";
import { LinkedInMonitor } from "../providers/linkedin/monitor.ts";
import { LinkedInScheduler } from "../providers/linkedin/scheduler.ts";

let linkedInClient: LinkedInClient | null = null;
let linkedInMonitor: LinkedInMonitor | null = null;
let linkedInScheduler: LinkedInScheduler | null = null;

function getLinkedInClient(ctx: PluginContext): LinkedInClient {
  if (linkedInClient) return linkedInClient;

  const config = ctx.config.getConfig();
  const socialsConfig = (config as any).socials?.linkedin;

  if (!socialsConfig?.clientId || !socialsConfig?.clientSecret) {
    throw new Error(
      "LinkedIn not configured. Add socials.linkedin.clientId and socials.linkedin.clientSecret to config.json. " +
        "Create a LinkedIn app at https://developer.linkedin.com first.",
    );
  }

  linkedInClient = new LinkedInClient(
    ctx.DATA_DIR,
    socialsConfig.clientId,
    socialsConfig.clientSecret,
  );
  return linkedInClient;
}

export function getLinkedInMonitor(ctx: PluginContext): LinkedInMonitor | null {
  if (linkedInMonitor) return linkedInMonitor;
  try {
    const client = getLinkedInClient(ctx);
    linkedInMonitor = new LinkedInMonitor(`${ctx.DATA_DIR}/choomfie.db`, client);
    return linkedInMonitor;
  } catch {
    return null;
  }
}

export function getLinkedInScheduler(ctx: PluginContext): LinkedInScheduler | null {
  if (linkedInScheduler) return linkedInScheduler;
  try {
    const client = getLinkedInClient(ctx);
    const monitor = getLinkedInMonitor(ctx);
    linkedInScheduler = new LinkedInScheduler(
      `${ctx.DATA_DIR}/choomfie.db`,
      client,
      monitor,
    );
    return linkedInScheduler;
  } catch {
    return null;
  }
}

export function destroyLinkedInClient(): void {
  linkedInScheduler?.destroy();
  linkedInScheduler = null;
  linkedInMonitor?.destroy();
  linkedInMonitor = null;
  linkedInClient?.destroy();
  linkedInClient = null;
}

export const linkedinTools: ToolDef[] = [
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
            "The link expires in 5 minutes.",
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
        const monitor = getLinkedInMonitor(ctx);
        if (monitor && result.id) {
          monitor.trackPost(result.id, postText);
        }

        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Posted to LinkedIn successfully.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_post_image",
      description:
        "Post to LinkedIn with an image. Accepts a URL or local file path for the image. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Post text (up to 3000 characters).",
          },
          image: {
            type: "string",
            description: "Image URL (https://...) or local file path.",
          },
          alt_text: {
            type: "string",
            description: "Alt text for accessibility (optional).",
          },
        },
        required: ["text", "image"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const postText = args.text as string;
        if (postText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }
        const result = await client.postWithImage(
          postText,
          args.image as string,
          args.alt_text as string | undefined,
        );
        const monitor = getLinkedInMonitor(ctx);
        if (monitor && result.id) monitor.trackPost(result.id, postText);
        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Posted to LinkedIn with image.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn image post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_post_images",
      description:
        "Post to LinkedIn with multiple images (2-20). Accepts URLs or local file paths. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Post text (up to 3000 characters).",
          },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Array of image URLs or local file paths (2-20 images).",
          },
        },
        required: ["text", "images"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const postText = args.text as string;
        const images = args.images as string[];
        if (postText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }
        if (images.length < 2 || images.length > 20) {
          return err("Multi-image posts require 2-20 images.");
        }
        const result = await client.postWithImages(postText, images);
        const monitor = getLinkedInMonitor(ctx);
        if (monitor && result.id) monitor.trackPost(result.id, postText);
        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(
          `Posted to LinkedIn with ${images.length} images.\nPost ID: ${result.id}${urlLine}`,
        );
      } catch (e: any) {
        return err(`LinkedIn multi-image post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_post_link",
      description:
        "Post to LinkedIn with a link/article card. Includes URL with optional title and description. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Post text (up to 3000 characters).",
          },
          url: {
            type: "string",
            description: "URL to share.",
          },
          title: {
            type: "string",
            description: "Link title (optional, for the article card).",
          },
          description: {
            type: "string",
            description: "Link description (optional, for the article card).",
          },
        },
        required: ["text", "url"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const postText = args.text as string;
        if (postText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }
        const result = await client.postWithLink(
          postText,
          args.url as string,
          args.title as string | undefined,
          args.description as string | undefined,
        );
        const monitor = getLinkedInMonitor(ctx);
        if (monitor && result.id) monitor.trackPost(result.id, postText);
        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Posted to LinkedIn with link.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn link post failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_edit",
      description:
        "Edit the text of an existing LinkedIn post. Only the post text can be changed. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "The post URN to edit.",
          },
          text: {
            type: "string",
            description: "New post text (up to 3000 characters).",
          },
        },
        required: ["post_urn", "text"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const newText = args.text as string;
        if (newText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }
        await client.editPost(args.post_urn as string, newText);
        return text(`Edited LinkedIn post: ${args.post_urn}`);
      } catch (e: any) {
        return err(`LinkedIn edit failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_poll",
      description:
        "Create a poll on LinkedIn. 2-4 options, duration 1/3/7/14 days. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Poll question / post text.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Poll options (2-4 choices).",
          },
          duration: {
            type: "number",
            enum: [1, 3, 7, 14],
            description: "Duration in days (default: 3).",
          },
        },
        required: ["text", "options"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const options = args.options as string[];
        if (options.length < 2 || options.length > 4) {
          return err("Polls require 2-4 options.");
        }
        const duration = ((args.duration as number) || 3) as 1 | 3 | 7 | 14;
        const result = await client.postPoll(args.text as string, options, duration);

        const monitor = getLinkedInMonitor(ctx);
        if (monitor && result.id) monitor.trackPost(result.id, args.text as string);

        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Poll created on LinkedIn.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn poll failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_repost",
      description:
        "Repost/share someone else's LinkedIn post. Optionally add your own commentary. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "URN of the post to repost.",
          },
          commentary: {
            type: "string",
            description: "Your commentary to add (optional, for a reshare with text).",
          },
        },
        required: ["post_urn"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const result = await client.repost(
          args.post_urn as string,
          args.commentary as string | undefined,
        );
        const urlLine = result.url ? `\nURL: ${result.url}` : "";
        return text(`Reposted on LinkedIn.\nPost ID: ${result.id}${urlLine}`);
      } catch (e: any) {
        return err(`LinkedIn repost failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_delete",
      description:
        "Delete a LinkedIn post by its URN (e.g. urn:li:share:123456). Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "The post URN to delete (returned by linkedin_post).",
          },
        },
        required: ["post_urn"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        await client.deletePost(args.post_urn as string);
        const monitor = getLinkedInMonitor(ctx);
        if (monitor) monitor.untrackPost(args.post_urn as string);
        return text(`Deleted LinkedIn post: ${args.post_urn}`);
      } catch (e: any) {
        return err(`LinkedIn delete failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_comments",
      description:
        "Get comments on a LinkedIn post. Use the post URN from linkedin_post.",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "The post URN to get comments for.",
          },
        },
        required: ["post_urn"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const comments = await client.getComments(args.post_urn as string);

        if (comments.length === 0) return text("No comments on this post.");

        const formatted = comments
          .map(
            (c, i) =>
              `**${i + 1}.** ${c.authorName}\n  ${c.text.slice(0, 300)}${c.text.length > 300 ? "..." : ""}`,
          )
          .join("\n\n");
        return text(formatted);
      } catch (e: any) {
        return err(`LinkedIn comments failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_comment",
      description: "Post a comment on a LinkedIn post. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "The post URN to comment on.",
          },
          text: {
            type: "string",
            description: "Comment text.",
          },
        },
        required: ["post_urn", "text"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const commentUrn = await client.commentOnPost(
          args.post_urn as string,
          args.text as string,
        );
        return text(`Comment posted.\nComment URN: ${commentUrn}`);
      } catch (e: any) {
        return err(`LinkedIn comment failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_react",
      description:
        "React to a LinkedIn post (like, celebrate, support, love, insightful, funny).",
      inputSchema: {
        type: "object" as const,
        properties: {
          post_urn: {
            type: "string",
            description: "The post URN to react to.",
          },
          reaction: {
            type: "string",
            enum: ["LIKE", "CELEBRATE", "SUPPORT", "LOVE", "INSIGHTFUL", "FUNNY"],
            description: "Reaction type (default: LIKE).",
          },
        },
        required: ["post_urn"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const client = getLinkedInClient(ctx);
        const reaction = ((args.reaction as string) || "LIKE") as
          | "LIKE"
          | "CELEBRATE"
          | "SUPPORT"
          | "LOVE"
          | "INSIGHTFUL"
          | "FUNNY";
        await client.reactToPost(args.post_urn as string, reaction);
        return text(`Reacted to post with ${reaction}.`);
      } catch (e: any) {
        return err(`LinkedIn react failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_schedule",
      description:
        "Schedule a LinkedIn post for later. Supports text, image, and link posts. " +
        "Use time like '2h', '30m', '3d', or a date like '2026-04-02 09:00'. " +
        "Optionally add a first_comment that auto-posts after the main post. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Post text (up to 3000 characters).",
          },
          time: {
            type: "string",
            description: "When to post: relative ('2h', '30m', '3d') or absolute ('2026-04-02 09:00').",
          },
          image: {
            type: "string",
            description: "Image URL or file path (optional, makes it an image post).",
          },
          url: {
            type: "string",
            description: "Link URL (optional, makes it a link/article post).",
          },
          link_title: {
            type: "string",
            description: "Link title for article card (optional).",
          },
          link_description: {
            type: "string",
            description: "Link description for article card (optional).",
          },
          first_comment: {
            type: "string",
            description: "Auto-post this comment after the main post (optional, good for CTAs).",
          },
        },
        required: ["text", "time"],
      },
    },
    handler: async (args, ctx) => {
      try {
        const scheduler = getLinkedInScheduler(ctx);
        if (!scheduler) return err("LinkedIn not configured.");

        const postText = args.text as string;
        if (postText.length > 3000) {
          return err("LinkedIn posts are limited to 3000 characters.");
        }

        const timeStr = args.time as string;
        let scheduledAt: string;

        const parsed = parseNaturalTime(timeStr);
        if (parsed) {
          scheduledAt = dateToSQLite(parsed);
        } else if (/^\d{4}-\d{2}-\d{2}/.test(timeStr)) {
          scheduledAt = timeStr.replace("T", " ").replace(/Z$/, "").trim();
        } else {
          return err(
            `Couldn't parse time "${timeStr}". Use '2h', '30m', '3d', or '2026-04-02 09:00'.`,
          );
        }

        const mediaType = args.image ? "image" : args.url ? "link" : "text";
        const post = scheduler.schedule({
          text: postText,
          scheduledAt,
          mediaType: mediaType as "text" | "image" | "link",
          imageUrl: args.image as string | undefined,
          linkUrl: args.url as string | undefined,
          linkTitle: args.link_title as string | undefined,
          linkDescription: args.link_description as string | undefined,
          firstComment: args.first_comment as string | undefined,
        });

        return text(
          `Scheduled LinkedIn post #${post.id} for ${post.scheduledAt} UTC.\n` +
            `Type: ${mediaType}` +
            (post.firstComment ? `\nFirst comment: "${post.firstComment}"` : ""),
        );
      } catch (e: any) {
        return err(`LinkedIn schedule failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_queue",
      description:
        "View or manage the LinkedIn post queue. Shows pending scheduled posts by default.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["list", "cancel", "all"],
            description:
              "Action: 'list' (default, pending only), 'all' (include posted/cancelled), 'cancel' (cancel a post by ID).",
          },
          id: {
            type: "number",
            description: "Post ID to cancel (required for action='cancel').",
          },
        },
      },
    },
    handler: async (args, ctx) => {
      try {
        const scheduler = getLinkedInScheduler(ctx);
        if (!scheduler) return err("LinkedIn not configured.");

        const action = (args.action as string) || "list";

        if (action === "cancel") {
          const id = args.id as number;
          if (!id) return err("Provide an ID to cancel.");
          const cancelled = scheduler.cancel(id);
          return cancelled
            ? text(`Cancelled scheduled post #${id}.`)
            : err(`Post #${id} not found or already posted/cancelled.`);
        }

        const posts = scheduler.getQueue(action === "all");
        if (posts.length === 0) {
          return text("No scheduled LinkedIn posts.");
        }

        const formatted = posts
          .map(
            (p) =>
              `**#${p.id}** [${p.status}] ${p.scheduledAt} UTC\n  ${p.mediaType} · "${p.text.slice(0, 80)}..."` +
              (p.postUrn ? `\n  URN: ${p.postUrn}` : "") +
              (p.error ? `\n  Error: ${p.error}` : ""),
          )
          .join("\n\n");
        return text(`**LinkedIn Queue (${posts.length}):**\n\n${formatted}`);
      } catch (e: any) {
        return err(`LinkedIn queue failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_monitor",
      description:
        "View tracked LinkedIn posts and their comment counts. Posts are auto-tracked when created. " +
        "Use action='check' to manually poll for new comments now.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: ["list", "check"],
            description:
              "Action: 'list' shows tracked posts (default), 'check' polls for new comments now.",
          },
        },
      },
    },
    handler: async (args, ctx) => {
      try {
        const monitor = getLinkedInMonitor(ctx);
        if (!monitor) return err("LinkedIn not configured or monitor unavailable.");

        const action = (args.action as string) || "list";

        if (action === "check") {
          const newComments = await monitor.pollOnce();
          if (newComments.length === 0) {
            return text("No new comments found on tracked posts.");
          }
          const formatted = newComments
            .map((c) => `**${c.authorName}** on "${c.postText}...":\n  ${c.text}`)
            .join("\n\n");
          return text(`Found ${newComments.length} new comment(s):\n\n${formatted}`);
        }

        const posts = monitor.getTrackedPosts();
        if (posts.length === 0) {
          return text(
            "No LinkedIn posts being tracked. Posts are auto-tracked when you create them.",
          );
        }

        const formatted = posts
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.text}...\n  URN: \`${p.postUrn}\`\n  Likes: ${p.likeCount} · Comments: ${p.commentCount} · Last checked: ${p.lastChecked || "never"}`,
          )
          .join("\n\n");
        return text(`**Tracked LinkedIn posts (${posts.length}):**\n\n${formatted}`);
      } catch (e: any) {
        return err(`LinkedIn monitor failed: ${e.message}`);
      }
    },
  },
  {
    definition: {
      name: "linkedin_analytics",
      description:
        "Show engagement analytics for your LinkedIn posts — likes, comments, and top performing content.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, ctx) => {
      try {
        const monitor = getLinkedInMonitor(ctx);
        if (!monitor) return err("LinkedIn not configured.");

        const posts = monitor.getTrackedPosts();
        if (posts.length === 0) {
          return text("No tracked posts yet. Post something first!");
        }

        const totalLikes = posts.reduce((sum, p) => sum + p.likeCount, 0);
        const totalComments = posts.reduce((sum, p) => sum + p.commentCount, 0);
        const sorted = [...posts].sort(
          (a, b) => b.likeCount + b.commentCount - (a.likeCount + a.commentCount),
        );
        const topPost = sorted[0];

        let output = `**LinkedIn Analytics (${posts.length} posts tracked)**\n\n`;
        output += `Total: **${totalLikes}** likes · **${totalComments}** comments\n`;
        output += `Avg per post: **${(totalLikes / posts.length).toFixed(1)}** likes · **${(totalComments / posts.length).toFixed(1)}** comments\n\n`;

        if (topPost) {
          output += `**Top post:** "${topPost.text}..."\n`;
          output += `  ${topPost.likeCount} likes · ${topPost.commentCount} comments\n\n`;
        }

        output += "**All posts:**\n";
        for (const p of sorted) {
          output += `- ${p.likeCount} likes · ${p.commentCount} comments — "${p.text.slice(0, 60)}..."\n`;
        }

        return text(output);
      } catch (e: any) {
        return err(`LinkedIn analytics failed: ${e.message}`);
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
            `Token expires in: ~${expiresIn} days`,
        );
      } catch (e: any) {
        return err(`LinkedIn status check failed: ${e.message}`);
      }
    },
  },
];
