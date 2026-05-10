/**
 * Access tools — manage allowlist from Discord (owner only).
 */

import type { ToolDef } from "../types.ts";
import { text, err } from "../types.ts";
import { saveAccess } from "../context.ts";

export const accessTools: ToolDef[] = [
  {
    definition: {
      name: "allow_user",
      description:
        "Add a Discord user to the allowlist so they can interact with the bot. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID to allow",
          },
        },
        required: ["user_id"],
      },
    },
    handler: async (args, ctx) => {
      const userId = args.user_id as string;
      if (ctx.allowedUsers.has(userId)) {
        return text(`User ${userId} is already on the allowlist.`);
      }
      ctx.allowedUsers.add(userId);
      await saveAccess(ctx);
      return text(`User ${userId} added to allowlist.`);
    },
  },
  {
    definition: {
      name: "remove_user",
      description:
        "Remove a Discord user from the allowlist. Cannot remove the owner. Owner only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "string",
            description: "Discord user ID to remove",
          },
        },
        required: ["user_id"],
      },
    },
    handler: async (args, ctx) => {
      const userId = args.user_id as string;
      if (userId === ctx.ownerUserId) {
        return err("Cannot remove the owner from the allowlist.");
      }
      if (!ctx.allowedUsers.has(userId)) {
        return err(`User ${userId} is not on the allowlist.`);
      }
      ctx.allowedUsers.delete(userId);
      await saveAccess(ctx);
      return text(`User ${userId} removed from allowlist.`);
    },
  },
  {
    definition: {
      name: "list_allowed_users",
      description: "Show all users on the allowlist.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, ctx) => {
      if (ctx.allowedUsers.size === 0) {
        return text("No users on allowlist (bootstrap mode — accepting all).");
      }
      const users = [...ctx.allowedUsers].map(
        (id) => `- <@${id}>${id === ctx.ownerUserId ? " (owner)" : ""}`
      );
      return text(`**Allowlist (${users.length}):**\n${users.join("\n")}`);
    },
  },
];
