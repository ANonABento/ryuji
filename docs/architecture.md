# Architecture

## Overview

Ryuji is a Claude Code Channels plugin — an MCP server that Claude Code spawns as a subprocess. It bridges Discord messages to Claude Code and provides persistent memory, reminders, and GitHub integration.

```
┌──────────────────────────────────────────────────┐
│                  Claude Code                      │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │         MCP Subprocess (stdio)             │  │
│  │                                            │  │
│  │  ┌────────┐ ┌──────┐ ┌──────┐ ┌────────┐  │  │
│  │  │Discord │ │Memory│ │Remind│ │ GitHub │  │  │
│  │  │Client  │ │Store │ │Timer │ │  (gh)  │  │  │
│  │  └───┬────┘ └──┬───┘ └──┬───┘ └───┬────┘  │  │
│  │      └────┬────┴────┬───┘─────────┘        │  │
│  │           │         │                      │  │
│  │      server.ts (MCP channel server)        │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Claude sees: <channel source="ryuji" ...>       │
│  Claude calls: reply, save_memory, set_reminder  │
└──────────────────────────────────────────────────┘
         │                          ▲
         ▼                          │
    Discord API                Discord API
```

## Data Flow

### Inbound (Discord → Claude)

1. User sends message on Discord (channel or DM)
2. discord.js client receives it
3. Server checks sender against allowlist
4. Attachments downloaded to `~/.claude/channels/ryuji/inbox/`
5. Server emits `notifications/claude/channel` with content + metadata
6. Claude Code receives it as a `<channel>` tag in context

### Outbound (Claude → Discord)

1. Claude calls an MCP tool (reply, react, pin_message, etc.)
2. server.ts handles the tool call via discord.js
3. Response sent to Discord
4. Tool returns confirmation to Claude

### Memory Flow

1. Claude calls `save_memory` during conversations
2. Written to SQLite at `~/.claude/channels/ryuji/ryuji.db`
3. On startup, core memories loaded into `instructions` string
4. Personality loaded from `personality` key in core memory

### Reminder Flow

1. Claude calls `set_reminder` with a due time
2. Stored in SQLite `reminders` table
3. Background timer checks every 30 seconds
4. When due, posts to the original Discord channel

### Permission Flow

1. Claude needs to run a tool (Bash, Write, etc.)
2. Claude Code sends permission request to the channel
3. server.ts DMs it to all allowlisted users
4. User replies `yes xxxxx` or `no xxxxx`
5. Verdict forwarded back to Claude Code

## State Locations

| What | Where |
|------|-------|
| Discord token | `~/.claude/channels/ryuji/.env` |
| Access list | `~/.claude/channels/ryuji/access.json` |
| Memory database | `~/.claude/channels/ryuji/ryuji.db` |
| Downloaded attachments | `~/.claude/channels/ryuji/inbox/` |
| Plugin code | `~/ryuji/` (or wherever you cloned it) |
| MCP server config | `~/.claude.json` → `mcpServers.ryuji` |

## Design Decisions

- **Channels plugin** over standalone bot — TOS compliant, full Claude Code power
- **bun:sqlite** over better-sqlite3 — native to Bun, zero dependencies
- **Single server.ts** — matches official plugin pattern, easy to understand
- **gh CLI** for GitHub — already installed and authenticated, no token management
- **Personality via memory** — changeable from Discord without editing code
