/**
 * Shared types for Choomfie modules.
 */

import type { Client } from "discord.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { MemoryStore } from "./memory.ts";
import type { ConfigManager } from "./config.ts";

export interface AppContext {
  discord: Client;
  mcp: Server;
  memory: MemoryStore;
  config: ConfigManager;
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
  CHANNELS_DIR: string;
  accessPath: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDef {
  definition: {
    name: string;
    description: string;
    inputSchema: object;
  };
  handler: (
    args: Record<string, unknown>,
    ctx: AppContext
  ) => Promise<ToolResult>;
}

/** Success result helper */
export const text = (s: string): ToolResult => ({
  content: [{ type: "text" as const, text: s }],
});

/** Error result helper */
export const err = (s: string): ToolResult => ({
  content: [{ type: "text" as const, text: s }],
  isError: true,
});
