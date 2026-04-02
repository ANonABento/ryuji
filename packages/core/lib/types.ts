/**
 * Core types — extends shared types with full AppContext.
 *
 * Re-exports shared types so existing core imports don't break.
 * Core's Plugin is the same as shared's — AppContext extends PluginContext
 * so plugin methods accepting AppContext satisfy PluginContext constraints.
 */

import type { Client } from "discord.js";
import type { PluginContext } from "@choomfie/shared";
import type { MemoryStore } from "./memory.ts";
import type { ConfigManager } from "./config.ts";
import type { ReminderScheduler } from "./reminders.ts";

// Re-export shared types so existing core code keeps working
export type { Plugin, ToolResult, ToolDef } from "@choomfie/shared";
export { text, err } from "@choomfie/shared";

export interface AppContext extends PluginContext {
  discord: Client;
  /** MCP Server (supervisor) or McpProxy (worker). Using any to avoid union type issues. */
  mcp: any;
  memory: MemoryStore;
  config: ConfigManager;
  plugins: import("@choomfie/shared").Plugin[];
  allowedUsers: Set<string>;
  ownerUserId: string | null;
  pendingPairings: Map<
    string,
    { userId: string; username: string; expiresAt: number }
  >;
  messageStats: {
    received: number;
    sent: number;
    byUser: Map<string, number>;
  };
  startedAt: number | null;
  activeChannels: Map<string, number>;
  lastMessageTime: Map<string, number>;
  DATA_DIR: string;
  accessPath: string;
  /** Timer-based reminder scheduler */
  reminderScheduler: ReminderScheduler;
}
