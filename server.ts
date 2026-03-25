#!/usr/bin/env bun
/**
 * Choomfie — Claude Code Channels plugin.
 *
 * MCP channel server that bridges Discord to Claude Code
 * with persistent memory, reminders, threads, and extensible tools.
 *
 * This is the entry point — all logic lives in lib/.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "./lib/context.ts";
import { createMcpServer } from "./lib/mcp-server.ts";
import { createDiscordClient } from "./lib/discord.ts";

// Initialize context (loads env, config, memory, access list)
const { ctx, discordToken } = await createContext();

// Create MCP server (registers tools + permission relay)
ctx.mcp = createMcpServer(ctx);

// Create Discord client (registers Ready + MessageCreate handlers)
ctx.discord = createDiscordClient(ctx);

// Exported for skills to use
export const pendingPairings = ctx.pendingPairings;
export const allowedUsers = ctx.allowedUsers;
export const ownerUserId = ctx.ownerUserId;
export const accessPath = ctx.accessPath;
export const DATA_DIR = ctx.DATA_DIR;

// Start
await ctx.mcp.connect(new StdioServerTransport());

if (discordToken) {
  await ctx.discord.login(discordToken);
} else {
  console.error(
    "Choomfie: No DISCORD_TOKEN configured. Run /choomfie:configure <token> to set it up."
  );
}
