/**
 * MCP proxy for the worker process.
 *
 * Duck-types the subset of MCP Server that worker code actually uses:
 *   - notification() — forwards Discord messages/permissions to supervisor via IPC
 *   - setNotificationHandler() — stores handler for permission relay (called from supervisor via IPC)
 *
 * This allows discord.ts, permissions.ts, and plugins to work unchanged
 * by assigning this proxy to ctx.mcp.
 */

import type { McpTransport, NotificationMessage } from "@choomfie/shared";
import type { SupervisorMessage } from "./ipc-types.ts";

type NotificationHandler = (msg: { params: Record<string, unknown> }) => Promise<void>;

export class McpProxy implements McpTransport {
  private notificationHandlers = new Map<string, NotificationHandler>();

  /**
   * Send a notification to Claude via supervisor IPC.
   * Matches the MCP Server.notification() signature used in discord.ts and voice manager.
   */
  notification(msg: NotificationMessage) {
    if (!process.send) {
      console.error("McpProxy: no IPC channel (not running as child process)");
      return;
    }
    try {
      process.send({
        type: "notification",
        method: msg.method,
        params: msg.params,
      });
    } catch {
      // Supervisor may have died — notification lost
    }
  }

  /**
   * Register a handler for incoming notifications (permission requests from Claude).
   * Matches the MCP Server.setNotificationHandler() signature used in permissions.ts.
   * The schema arg is ignored — routing is done by method name from the supervisor.
   */
  setNotificationHandler(_schema: unknown, handler: NotificationHandler) {
    // permissions.ts registers for "notifications/claude/channel/permission_request"
    // We store it generically — supervisor forwards permission_request IPC messages here
    this.notificationHandlers.set("permission_request", handler);
  }

  /**
   * Called by worker when supervisor forwards a permission request via IPC.
   */
  async handlePermissionRequest(msg: SupervisorMessage) {
    if (msg.type !== "permission_request") return;
    const handler = this.notificationHandlers.get("permission_request");
    if (handler) {
      await handler({ params: msg.params as Record<string, unknown> });
    }
  }

  /**
   * Request supervisor to restart the worker process.
   * Used after config changes that require fresh system prompt (persona switch, plugin toggle, etc.).
   * Pass chat_id to get a confirmation message sent to that channel after restart completes.
   */
  requestRestart(reason: string, chat_id?: string) {
    if (!process.send) {
      console.error("McpProxy: no IPC channel — cannot request restart");
      return;
    }
    try {
      process.send({ type: "request_restart", reason, chat_id });
    } catch {
      // Supervisor may have died
    }
  }
}
