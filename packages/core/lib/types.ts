/**
 * Core types — extends shared types with full AppContext.
 *
 * Re-exports shared types so existing core imports don't break.
 */

import type { Client, GatewayIntentBits, Interaction, Message } from "discord.js";
import type { PluginContext } from "@choomfie/shared";
import type { MemoryStore } from "./memory.ts";
import type { ConfigManager } from "./config.ts";
import type { ReminderScheduler } from "./reminders.ts";

// Re-export shared types so existing core code keeps working
export type { ToolResult, ToolDef } from "@choomfie/shared";
export { text, err } from "@choomfie/shared";

export interface AppContext extends PluginContext {
  discord: Client;
  /** MCP Server (supervisor) or McpProxy (worker). Using any to avoid union type issues. */
  mcp: any;
  memory: MemoryStore;
  config: ConfigManager;
  plugins: Plugin[];
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

export interface Plugin {
  /** Unique identifier, e.g. "voice", "language-learning" */
  name: string;
  /** Tools this plugin provides */
  tools?: import("@choomfie/shared").ToolDef[];
  /** Lines to append to the MCP system prompt */
  instructions?: string[];
  /** Additional Discord gateway intents this plugin needs */
  intents?: GatewayIntentBits[];
  /** Tool names from this plugin that non-owner users may call */
  userTools?: string[];
  /** Called once after Discord is ready */
  init?(ctx: AppContext): Promise<void>;
  /** Called on every Discord MessageCreate (before default handler) */
  onMessage?(message: Message, ctx: AppContext): Promise<void>;
  /** Called on every Discord InteractionCreate (before default handler) */
  onInteraction?(interaction: Interaction, ctx: AppContext): Promise<void>;
  /** Cleanup on shutdown */
  destroy?(): Promise<void>;
}
