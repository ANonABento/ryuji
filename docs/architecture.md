# Architecture

## Overview

Ryuji is a **Claude Code Channels plugin** — an MCP (Model Context Protocol) server that Claude Code spawns as a subprocess. It bridges Discord messages into Claude Code sessions and adds persistent memory tools.

```
┌──────────────────────────────────────────────┐
│                Claude Code                    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         MCP Subprocess (stdio)         │  │
│  │                                        │  │
│  │  ┌──────────┐  ┌────────┐  ┌───────┐  │  │
│  │  │ Discord  │  │ Memory │  │ Perm  │  │  │
│  │  │ Client   │  │ Store  │  │ Relay │  │  │
│  │  └────┬─────┘  └────┬───┘  └───┬───┘  │  │
│  │       │             │          │       │  │
│  │  server.ts (MCP channel server)        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Claude sees: <channel source="ryuji" ...>   │
│  Claude calls: reply, save_memory, react     │
└──────────────────────────────────────────────┘
         │                        ▲
         ▼                        │
    Discord API              Discord API
    (incoming)               (outgoing)
```

## Data Flow

### Inbound (Discord → Claude)

1. User sends message on Discord
2. discord.js client receives it
3. Server checks sender against allowlist
4. Server emits `notifications/claude/channel` with message content + metadata
5. Claude Code receives it as a `<channel>` tag in context
6. Claude processes and decides how to respond

### Outbound (Claude → Discord)

1. Claude calls the `reply` MCP tool with `chat_id` and text
2. server.ts handles the tool call
3. discord.js sends the message to the Discord channel
4. Tool returns confirmation to Claude

### Memory Flow

1. During conversation, Claude calls `save_memory` to store important facts
2. Memory is written to SQLite (`~/.claude/channels/ryuji/ryuji.db`)
3. On next session start, core memories are loaded into the `instructions` string
4. Claude has context about the user from the very first message

### Permission Flow

1. Claude needs to run a tool (e.g., Bash command)
2. Claude Code sends permission request to the channel
3. server.ts forwards it as a DM to allowlisted Discord users
4. User replies "yes xxxxx" or "no xxxxx"
5. server.ts sends verdict back to Claude Code
6. Claude Code proceeds or denies

## Key Design Decisions

### Channels Plugin (not standalone bot)

We build on Anthropic's official Channels system because:
- **TOS compliant** — it's the intended way to use Claude Code remotely
- **Full Claude Code power** — file editing, code execution, MCP servers all work
- **No API key needed** — uses Max plan auth
- **Security built-in** — allowlists, pairing codes, permission relay

### MCP Protocol

The server communicates with Claude Code via MCP over stdio:
- `notifications/claude/channel` — push messages to Claude
- `ListToolsRequestSchema` — register reply + memory tools
- `CallToolRequestSchema` — handle tool calls
- `notifications/claude/channel/permission` — relay permission decisions

### SQLite for Memory

Same rationale as before — zero infrastructure, single file, portable. The database lives in `~/.claude/channels/ryuji/ryuji.db` so it persists independently of the plugin code.

### Single Server File

The server.ts file handles everything: Discord client, MCP server, memory tools, permission relay. This matches the pattern of official Anthropic plugins (their Discord plugin is also a single server.ts). We split memory into `lib/memory.ts` for clarity.

## State Locations

| What | Where |
|------|-------|
| Discord token | `~/.claude/channels/ryuji/.env` |
| Access list | `~/.claude/channels/ryuji/access.json` |
| Memory database | `~/.claude/channels/ryuji/ryuji.db` |
| Plugin code | `~/.claude/plugins/cache/` (installed) or local dev dir |
