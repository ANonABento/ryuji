import { z } from "zod";
import type { AnyObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { PermissionRequestParams } from "./handlers/permission-buttons.ts";

export const PERMISSION_REQUEST_NOTIFICATION_METHOD =
  "notifications/claude/channel/permission_request";

const rawPermissionRequestNotificationSchema = z.object({
  method: z.literal(PERMISSION_REQUEST_NOTIFICATION_METHOD),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

export const permissionRequestNotificationSchema =
  rawPermissionRequestNotificationSchema as unknown as AnyObjectSchema;

export interface PermissionRequestNotification {
  method: typeof PERMISSION_REQUEST_NOTIFICATION_METHOD;
  params: PermissionRequestParams;
}
