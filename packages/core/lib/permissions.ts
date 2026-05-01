/**
 * Permission relay — forwards tool approval requests to Discord owner DM.
 */

import { z } from "zod";
import type { AnyObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { AppContext } from "./types.ts";
import {
  buildPermissionMessage,
  buildPermissionTextFallback,
} from "./handlers/permission-buttons.ts";

const permissionRequestNotificationSchema = z.object({
  method: z.literal(
    "notifications/claude/channel/permission_request"
  ),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
}) as unknown as AnyObjectSchema;

export function registerPermissionRelay(ctx: AppContext) {
  ctx.mcp.setNotificationHandler(
    permissionRequestNotificationSchema,
    async ({ params }) => {
      const message = buildPermissionMessage(params);
      const textFallback = buildPermissionTextFallback(params);

      // Only send permission requests to the owner (security layer 3)
      const permTarget = ctx.ownerUserId
        ? [ctx.ownerUserId]
        : [...ctx.allowedUsers];
      for (const uid of permTarget) {
        let user;
        try {
          user = await ctx.discord.users.fetch(uid);
        } catch {
          continue;
        }
        try {
          await user.send(message);
        } catch {
          // Embed/components send failed (component quota, API change, etc.).
          // Fall back to plain text so `yes <code>` / `no <code>` still works
          // via PERMISSION_REPLY_RE in discord.ts.
          try {
            await user.send(textFallback);
          } catch {
            // DMs disabled — give up silently.
          }
        }
      }
    }
  );
}
