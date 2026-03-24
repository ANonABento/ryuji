# Architecture

## Overview

Ryuji is a thin orchestration layer that connects **channels** (Discord, terminal) to the **Claude Code CLI** via the official **Agent SDK**, with a **memory system** and **skills registry** in between.

```
┌─────────────┐     ┌─────────────┐
│  Discord    │     │  Terminal   │
│  Adapter    │     │  REPL       │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └───────┬───────────┘
               │
        ┌──────▼──────┐
        │  Orchestrator│
        │  (index.ts)  │
        └──────┬──────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Memory │ │Skills │ │Agent  │
│Store  │ │Registry│ │(CLI)  │
└───────┘ └───────┘ └───────┘
  SQLite    Plugins   claude
                      --print
```

## Data Flow

1. **User sends message** via Discord or terminal
2. **Channel adapter** extracts the message text and session ID
3. **Orchestrator** loads:
   - Core memory → injected into system prompt
   - Available skills → listed in system prompt
4. **Agent** runs `claude --print` with the composed prompt
5. **Response** flows back through the channel adapter to the user
6. **Memory updates** — agent can trigger core/archival memory writes

## Key Design Decisions

### Claude Code CLI over raw API

We use `claude --print` (and eventually the Agent SDK subprocess) instead of the Anthropic API because:

- **Max plan compatible** — no API key or extra billing needed
- **Full agent capabilities** — file editing, code execution, MCP servers all work
- **Same model access** — Opus, Sonnet, Haiku via your subscription
- **TOS compliant** — official CLI usage, not OAuth token extraction

### SQLite for memory

SQLite was chosen over Postgres/Redis because:

- **Zero infrastructure** — single file, no server needed
- **Runs on Mac** — no Docker required for local dev
- **Fast enough** — handles thousands of memories without issue
- **Portable** — `ryuji.db` can be backed up or moved easily

### Two-tier memory (Letta-inspired)

Inspired by [Letta/MemGPT](https://github.com/letta-ai/letta):

- **Core memory** — always loaded into context. User profile, preferences, active goals. Think of it as the agent's "working memory."
- **Archival memory** — searchable long-term storage. Past conversations, learnings, facts. Queried on demand, not always in context.

This avoids bloating the context window while keeping important info always available.

## Component Details

### Core Agent (`src/core/agent.ts`)

Wraps the Claude Code CLI. Currently uses `child_process.execFile` with `claude --print`. Will migrate to the Agent SDK subprocess API for streaming, tool control, and session management.

### Memory Store (`src/memory/store.ts`)

SQLite database with two tables:
- `core_memory` — key/value pairs, always injected into system prompt
- `archival_memory` — timestamped entries with tags, searchable via LIKE queries

Future: vector embeddings for semantic search in archival memory.

### Skills Registry (`src/skills/registry.ts`)

Simple Map-based registry. Skills are objects with `name`, `description`, and `execute` function. Registered skills are listed in the agent's system prompt so it knows what tools are available.

### Discord Bot (`src/discord/bot.ts`)

discord.js v14 bot. Listens for `!ryuji` prefix. Handles message splitting for Discord's 2000 char limit. One session per Discord user ID.

### Terminal REPL (`src/terminal/repl.ts`)

Node.js readline-based REPL. Built-in `/memory` and `/remember` commands. Single session.

## Future Architecture

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Discord │ │Terminal │ │ Slack   │ │Telegram │
└────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
     └──────┬────┴─────┬─────┘───────────┘
            │          │
     ┌──────▼──────┐   │
     │ Session     │   │
     │ Manager     │   │
     └──────┬──────┘   │
            │          │
     ┌──────▼──────────▼──┐
     │  Agent SDK          │
     │  (subprocess)       │
     │  ┌────────────────┐ │
     │  │ MCP Servers    │ │
     │  │ File Access    │ │
     │  │ Code Execution │ │
     │  └────────────────┘ │
     └──────────┬──────────┘
                │
     ┌──────────┼──────────┐
     │          │          │
 ┌───▼───┐ ┌───▼───┐ ┌───▼────┐
 │Memory │ │Skills │ │Scheduler│
 │(SQLite)│ │(Plugin)│ │(Cron)  │
 └───────┘ └───────┘ └────────┘
```
