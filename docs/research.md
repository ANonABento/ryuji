# Research & Design Decisions

Background research and decisions that shaped Ryuji's design.

## Why Not Just Use an Existing Project?

We evaluated several approaches before building Ryuji:

### Hermes Agent (NousResearch)

[github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — 11k+ stars

Self-improving AI agent with Discord, Telegram, Slack, skills system, cron scheduling, MCP integration. Very feature-rich.

**Why we didn't use it:** Requires an API key. Doesn't work with Claude Max plan directly. Would need a proxy to bridge Claude Code CLI to Hermes, which adds complexity and potential TOS issues.

**What we borrowed:** The concept of a skills system and self-improving memory.

### OpenClaw

[github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) — large community

Self-hosted personal AI assistant gateway. 20+ messaging platforms, 5,400+ skills, voice support, multi-agent routing.

**Why we didn't use it:** Same API key requirement. Forking and replacing the LLM layer with Agent SDK would be a significant effort. Overkill for personal use.

**What we borrowed:** Multi-channel architecture pattern, skills registry concept.

### Max Plan API Proxies (REJECTED)

Several projects exist that proxy Claude Max plan credentials as API endpoints:

- `AntonioAEMartins/claude-code-proxy` — wraps CLI as subprocess
- `NYTEMODEONLY/claude-max-proxy` — uses OAuth tokens from keychain
- `horselock/claude-code-proxy` — standalone OAuth
- `rynfar/opencode-claude-max-proxy` — uses Agent SDK

**Why we rejected ALL of these:**

- **Anthropic TOS Section 3.7** explicitly prohibits automated/non-human access except via API keys
- Anthropic has **actively enforced** this: server-side blocks, legal notices to projects (OpenCode), account bans
- Anthropic deployed detection for OAuth tokens used outside official clients (Jan 2026)
- Risk of account ban is real and increasing

**Decision: Stay TOS-compliant. Use Claude Code CLI directly.**

### Existing Claude Code Bots

| Project | Stars | What it does |
|---------|-------|-------------|
| `op7418/Claude-to-IM` | 345 | Telegram/Discord/Feishu bridge |
| `mpociot/claude-code-slack-bot` | 143 | Slack bot |
| `timoconnellaus/claude-code-discord-bot` | 68 | Discord bot |
| `dzhng/claude-agent-server` | 545 | WebSocket-controlled agent |

**Why we didn't fork these:** Most are thin wrappers without memory, skills, or extensibility. We wanted a foundation we could grow into a Hermes-like experience.

**What we borrowed:** The `claude --print` subprocess pattern from these projects.

### Memory: Letta (MemGPT)

[github.com/letta-ai/letta](https://github.com/letta-ai/letta) — 13k stars

Best-in-class persistent memory for LLM agents. Two-tier architecture: core memory (always in context) + archival memory (searchable).

**Why we didn't use it directly:** It's a full agent framework, not just a memory module. We'd be replacing its LLM layer while only using the memory part.

**What we borrowed:** The two-tier memory architecture (core + archival), self-editing memory concept.

### Session Memory: claude-mem

[github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — 39.8k stars

Claude Code plugin that captures session activity and injects into future sessions.

**Planned integration:** May integrate as a complementary memory layer alongside our SQLite store.

## Key Design Decisions

### 1. Claude Code CLI as the Engine

The Agent SDK spawns `claude` as a subprocess and communicates via JSON streaming. This means:

- Full access to Claude Code's capabilities (file ops, code exec, MCP)
- Uses Max plan auth — no API key needed
- TOS compliant — it's the official tool
- Trade-off: slightly slower than raw API calls

### 2. SQLite over External Databases

For a personal assistant running on a Mac:

- No Docker/Postgres/Redis infrastructure needed
- Single file (`ryuji.db`) — easy to backup or move
- `better-sqlite3` is synchronous and fast for our scale
- Can always migrate to Postgres later if needed

### 3. TypeScript

The Agent SDK has official TypeScript support (`@anthropic-ai/claude-agent-sdk`). Discord.js is TypeScript-native. The ecosystem alignment made this an easy choice.

### 4. Modular Channel Architecture

Each messaging platform is an "adapter" that transforms platform-specific messages into a common format. This makes adding new platforms (Slack, Telegram) straightforward without touching the core agent logic.

## Inspiration & Prior Art

| Project | Inspiration |
|---------|-------------|
| Hermes Agent | Skills system, self-improving memory, multi-platform |
| Letta/MemGPT | Two-tier memory, self-editing core memory |
| OpenClaw | Multi-channel gateway architecture |
| claude-mem | Session-based learning |
| Iron Chef | The name candidates (Tetsujin, Itamae) |
| Dragon Ball / anime | The final name — Ryuji (dragon child) |
