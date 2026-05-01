/**
 * Shared types for Choomfie modules.
 *
 * Plugin, ToolDef, ToolResult, text(), err() — used by all packages.
 * AppContext stays in @choomfie/core (extends PluginContext).
 */

import type { GatewayIntentBits, Interaction, Message } from "discord.js";
import type { PluginContext } from "./plugin-context.ts";

export interface Plugin {
  /** Unique identifier, e.g. "voice", "browser" */
  name: string;
  /** Tools this plugin provides */
  tools?: ToolDef[];
  /** Lines to append to the MCP system prompt */
  instructions?: string[];
  /** Additional Discord gateway intents this plugin needs */
  intents?: GatewayIntentBits[];
  /** Tool names from this plugin that non-owner users may call */
  userTools?: string[];
  /** Called once after Discord is ready */
  init?(ctx: PluginContext): Promise<void>;
  /** Called on every Discord MessageCreate (before default handler) */
  onMessage?(message: Message, ctx: PluginContext): Promise<void>;
  /** Called on every Discord InteractionCreate (before default handler) */
  onInteraction?(interaction: Interaction, ctx: PluginContext): Promise<void>;
  /** Cleanup on shutdown */
  destroy?(): Promise<void>;
}

export interface ToolResult {
  [key: string]: unknown;
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
    ctx: PluginContext
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
