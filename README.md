# Ryuji 🐉

Personal AI agent powered by Claude Code CLI. Uses your Max plan — no API key needed.

> *"Ryuji" (龍二) — Dragon child. Named for the spirit of Japanese craftsmanship and anime energy.*

## What is this?

Ryuji is a self-hosted personal AI assistant that runs on top of **Claude Code CLI** using the official **Agent SDK**. Unlike tools that need API keys, Ryuji uses your existing Claude Max subscription — the same auth your CLI already has.

Think of it as your own [Hermes Agent](https://github.com/NousResearch/hermes-agent) or [OpenClaw](https://github.com/openclaw/openclaw), but built specifically for Claude Code.

## Features

- **Discord bot** — chat with Ryuji in your server via `!ryuji`
- **Terminal REPL** — interactive chat with `/memory` and `/remember` commands
- **Persistent memory** — Letta-inspired two-tier memory system (core + archival)
- **Skills system** — extensible tool/skill registry
- **Claude Code CLI** — full agentic capabilities (file editing, code execution, MCP servers)
- **No API key needed** — uses your Max plan auth via Agent SDK

## Quick Start

```bash
git clone https://github.com/ANonABento/ryuji.git
cd ryuji
npm install
cp .env.example .env

# Terminal mode (works immediately)
npm run terminal

# Discord bot (add token to .env first)
npm run discord
```

## Usage

### Terminal REPL

```bash
npm run terminal
```

```
ryuji> what's in my current directory?
ryuji> /remember name=Ben
ryuji> /memory
```

| Command | Description |
|---------|-------------|
| `/memory` | Show all core memories |
| `/remember key=value` | Save a core memory |
| `Ctrl+C` | Exit |

### Discord Bot

```bash
npm run discord
```

Prefix messages with `!ryuji`:

```
!ryuji what's the weather like?
!ryuji help me write a python script
```

## Architecture

```
src/
├── core/agent.ts        # Claude Code CLI wrapper (claude --print)
├── discord/bot.ts       # Discord adapter
├── terminal/repl.ts     # Terminal REPL
├── memory/store.ts      # SQLite memory (core + archival)
├── skills/registry.ts   # Skill/tool system
└── index.ts             # Entry point
```

See [docs/](docs/) for detailed documentation:

- [Architecture](docs/architecture.md) — system design and data flow
- [Memory System](docs/memory.md) — how persistent memory works
- [Skills](docs/skills.md) — creating and registering skills
- [Discord Setup](docs/discord-setup.md) — creating a Discord bot
- [Roadmap](docs/roadmap.md) — planned features and milestones
- [Research](docs/research.md) — prior art and design decisions

## Why Ryuji?

| Approach | Cost | Effort | Power |
|----------|------|--------|-------|
| Hermes Agent + API key | $$/month | Low | High |
| OpenClaw fork + API key | $$/month | Medium | Very high |
| Max plan proxy (TOS risk) | Free | Low | High |
| **Ryuji (Claude Code CLI)** | **Free (Max plan)** | **Medium** | **High** |

Ryuji is the sweet spot: full Claude agent capabilities, no extra cost, no TOS risk.

## License

MIT
