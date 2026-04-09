import type { ToolDef } from "@choomfie/shared";
import { err, text } from "@choomfie/shared";
import { getLinkedInClient, getLinkedInMonitor } from "./linkedin-runtime.ts";
import { validateLinkedInText } from "./linkedin-tool-helpers.ts";

export const linkedinManagementTools: ToolDef[] = [
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
            "It will automatically capture the authorization and shut down.\n" +
            "The link expires in 5 minutes.",
        );
      } catch (e: any) {
        return err(`LinkedIn auth failed: ${e.message}`);
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
        const validationError = validateLinkedInText(newText);
        if (validationError) return err(validationError);
        await client.editPost(args.post_urn as string, newText);
        return text(`Edited LinkedIn post: ${args.post_urn}`);
      } catch (e: any) {
        return err(`LinkedIn edit failed: ${e.message}`);
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
];
