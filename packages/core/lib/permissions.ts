/**
 * Permission relay — forwards tool approval requests to Discord owner DM
 * with interactive Approve/Deny buttons, falling back to text if needed.
 */

import { z } from "zod";
import type { AppContext } from "./types.ts";
import { buildPermissionButtons } from "./handlers/permission-buttons.ts";

export function registerPermissionRelay(ctx: AppContext) {
  ctx.mcp.setNotificationHandler(
    z.object({
      method: z.literal(
        "notifications/claude/channel/permission_request"
      ),
      params: z.object({
        request_id: z.string(),
        tool_name: z.string(),
        description: z.string(),
        input_preview: z.string(),
      }),
    }),
    async ({ params }) => {
      const summary = [
        `**Permission request** \`${params.request_id}\``,
        `**Tool:** ${params.tool_name}`,
        `**Action:** ${params.description}`,
        `\`\`\`\n${params.input_preview}\n\`\`\``,
      ].join("\n");

      const buttonPrompt = `${summary}\n\nTap **Approve** or **Deny** below. (Or reply \`yes ${params.request_id}\` / \`no ${params.request_id}\`.)`;
      const textPrompt = `${summary}\n\nReply \`yes ${params.request_id}\` to allow or \`no ${params.request_id}\` to deny.`;

      // Only send permission requests to the owner (security layer 3).
      const permTarget = ctx.ownerUserId
        ? [ctx.ownerUserId]
        : [...ctx.allowedUsers];
      for (const uid of permTarget) {
        let user;
        try {
          user = await ctx.discord.users.fetch(uid);
        } catch {
          continue; // User not reachable
        }

        try {
          await user.send({
            content: buttonPrompt,
            components: [buildPermissionButtons(params.request_id)],
          });
        } catch {
          // Button send failed (component quota, API change, etc.) — try plain text.
          try {
            await user.send(textPrompt);
          } catch {
            // DM unreachable (user has DMs disabled)
          }
        }
      }
    }
  );
}
