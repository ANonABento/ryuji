# Ryuji — Claude Code Instructions

## Project Overview

Ryuji is a personal AI agent that runs on top of Claude Code CLI. It provides Discord and terminal interfaces with persistent memory and extensible skills.

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **Language:** TypeScript (strict mode)
- **Agent Backend:** Claude Code CLI via `claude --print` (migrating to Agent SDK)
- **Database:** SQLite via `better-sqlite3`
- **Discord:** discord.js v14
- **Build:** tsc + tsx for dev

## Project Structure

```
src/
├── core/agent.ts        # Claude Code CLI wrapper
├── discord/bot.ts       # Discord bot adapter
├── terminal/repl.ts     # Terminal REPL
├── memory/store.ts      # SQLite memory (core + archival)
├── skills/registry.ts   # Skill/tool registration
└── index.ts             # Entry point
```

## Conventions

- Use ES module imports (`.js` extensions in import paths)
- Keep files small and focused — one concept per file
- No classes unless they manage state (like MemoryStore)
- Prefer `async/await` over callbacks
- Error messages should be user-friendly, not stack traces

## Key Commands

```bash
npm run dev        # Watch mode (both Discord + terminal)
npm run terminal   # Terminal REPL only
npm run discord    # Discord bot only
npm run build      # TypeScript compile
```

## Important Notes

- This project does NOT use the Anthropic API directly — it uses Claude Code CLI
- No API keys are needed — it uses the developer's Max plan auth
- Memory is stored in `ryuji.db` (SQLite, gitignored)
- The `.env` file contains Discord tokens and is gitignored
