/**
 * Permission relay — forwards tool approval requests to Discord owner DM.
 */

import { z } from "zod";
import type { AppContext } from "./types.ts";

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
      const text = [
        `**Permission request** \`${params.request_id}\``,
        `**Tool:** ${params.tool_name}`,
        `**Action:** ${params.description}`,
        `\`\`\`\n${params.input_preview}\n\`\`\``,
        "",
        `Reply \`yes ${params.request_id}\` to allow or \`no ${params.request_id}\` to deny.`,
      ].join("\n");

      // Only send permission requests to the owner (security layer 3)
      const permTarget = ctx.ownerUserId
        ? [ctx.ownerUserId]
        : [...ctx.allowedUsers];
      for (const uid of permTarget) {
        try {
          const user = await ctx.discord.users.fetch(uid);
          await user.send(text);
        } catch {
          // User not reachable via DM
        }
      }
    }
  );
}
