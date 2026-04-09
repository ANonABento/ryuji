import type { ToolDef } from "@choomfie/shared";
import { err, text } from "@choomfie/shared";
import { getLinkedInClient } from "./linkedin-runtime.ts";
import {
  formatLinkedInPostResult,
  trackLinkedInPost,
  validateLinkedInText,
} from "./linkedin-tool-helpers.ts";

export const linkedinPublishingTools: ToolDef[] = [
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
        const validationError = validateLinkedInText(postText);
        if (validationError) return err(validationError);

        const result = await client.post(postText);
        trackLinkedInPost(ctx, result, postText);
        return text(formatLinkedInPostResult("Posted to LinkedIn successfully.", result));
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
        const validationError = validateLinkedInText(postText);
        if (validationError) return err(validationError);

        const result = await client.postWithImage(
          postText,
          args.image as string,
          args.alt_text as string | undefined,
        );
        trackLinkedInPost(ctx, result, postText);
        return text(formatLinkedInPostResult("Posted to LinkedIn with image.", result));
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
        const validationError = validateLinkedInText(postText);
        if (validationError) return err(validationError);
        if (images.length < 2 || images.length > 20) {
          return err("Multi-image posts require 2-20 images.");
        }

        const result = await client.postWithImages(postText, images);
        trackLinkedInPost(ctx, result, postText);
        return text(formatLinkedInPostResult(`Posted to LinkedIn with ${images.length} images.`, result));
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
        const validationError = validateLinkedInText(postText);
        if (validationError) return err(validationError);

        const result = await client.postWithLink(
          postText,
          args.url as string,
          args.title as string | undefined,
          args.description as string | undefined,
        );
        trackLinkedInPost(ctx, result, postText);
        return text(formatLinkedInPostResult("Posted to LinkedIn with link.", result));
      } catch (e: any) {
        return err(`LinkedIn link post failed: ${e.message}`);
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
        const pollText = args.text as string;
        const validationError = validateLinkedInText(pollText);
        if (validationError) return err(validationError);

        const options = args.options as string[];
        if (options.length < 2 || options.length > 4) {
          return err("Polls require 2-4 options.");
        }

        const duration = ((args.duration as number) || 3) as 1 | 3 | 7 | 14;
        const result = await client.postPoll(pollText, options, duration);
        trackLinkedInPost(ctx, result, pollText);
        return text(formatLinkedInPostResult("Poll created on LinkedIn.", result));
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
        return text(formatLinkedInPostResult("Reposted on LinkedIn.", result));
      } catch (e: any) {
        return err(`LinkedIn repost failed: ${e.message}`);
      }
    },
  },
];
