# Ryuji — Claude Code Instructions

## Project Overview

Ryuji is a Claude Code Channels plugin — an MCP server that bridges Discord to Claude Code with persistent memory. It runs as a subprocess inside Claude Code, not as a standalone bot.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Protocol:** MCP (Model Context Protocol) over stdio
- **Database:** SQLite via `better-sqlite3`
- **Discord:** discord.js v14
- **Framework:** `@modelcontextprotocol/sdk`

## Project Structure

```
.claude-plugin/plugin.json   # Plugin metadata
.mcp.json                    # How Claude Code spawns the server
server.ts                    # MCP channel server (single entry point)
lib/memory.ts                # SQLite memory store (core + archival)
skills/
├── configure/SKILL.md       # /ryuji:configure — set Discord token
├── access/SKILL.md          # /ryuji:access — manage allowlist
└── memory/SKILL.md          # /ryuji:memory — view/manage memories
```

## How It Works

1. Claude Code spawns `bun server.ts` as an MCP subprocess
2. server.ts connects to Discord via discord.js
3. Incoming Discord messages → `notifications/claude/channel` → Claude Code
4. Claude processes and calls the `reply` tool → server.ts → Discord
5. Memory tools (save_memory, search_memory, etc.) persist to SQLite

## Key Concepts

- This is a **Channels plugin**, not a standalone bot
- It uses the MCP protocol, not the Anthropic API
- State lives in `~/.claude/channels/ryuji/` (token, access list, database)
- The `instructions` string in Server constructor is the system prompt injection
- Skills are slash commands defined in `skills/*/SKILL.md`

## Conventions

- Single server.ts entry point — keep it as one file unless it gets too large
- Memory store is the only module in lib/ — add more as needed
- Use Bun APIs where possible (Bun.file, etc.)
- Console output goes to stderr (stdout is MCP stdio transport)
