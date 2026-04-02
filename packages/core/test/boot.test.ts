/**
 * Boot smoke test — verifies the MCP server can be constructed
 * without crashing (catches init-ordering bugs like null ctx.mcp).
 *
 * Runs without Discord token or stdio transport — just checks
 * that createContext + loadPlugins + createMcpServer don't throw.
 */
import { test, expect } from "bun:test";
import { createContext } from "../lib/context.ts";
import { loadPlugins } from "../lib/plugins.ts";
import { createMcpServer } from "../lib/mcp-server.ts";
import { createDiscordClient } from "../lib/discord.ts";

test("server boots without crashing", async () => {
  const { ctx } = await createContext();
  ctx.plugins = await loadPlugins(ctx.config);
  ctx.mcp = createMcpServer(ctx);
  ctx.discord = createDiscordClient(ctx);

  expect(ctx.mcp).toBeTruthy();
  expect(ctx.discord).toBeTruthy();
});
