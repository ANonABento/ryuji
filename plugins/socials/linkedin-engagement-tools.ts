import type { ToolDef } from "@choomfie/shared";
import { err, text } from "@choomfie/shared";
import { getLinkedInClient } from "./linkedin-runtime.ts";

export const linkedinEngagementTools: ToolDef[] = [
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
            (comment, i) =>
              `**${i + 1}.** ${comment.authorName}\n  ${comment.text.slice(0, 300)}${comment.text.length > 300 ? "..." : ""}`,
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
      description:
        "Post a comment on a LinkedIn post. Owner only.",
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
          "LIKE" | "CELEBRATE" | "SUPPORT" | "LOVE" | "INSIGHTFUL" | "FUNNY";
        await client.reactToPost(args.post_urn as string, reaction);
        return text(`Reacted to post with ${reaction}.`);
      } catch (e: any) {
        return err(`LinkedIn react failed: ${e.message}`);
      }
    },
  },
];
