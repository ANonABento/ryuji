# Choomfie

A personal AI agent that lives in Discord, powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Persistent memory, switchable personas, voice chat, web browsing, language tutoring, social media integration, and more.

## What is this?

Choomfie is a Claude Code plugin that bridges Discord to Claude. It runs as an MCP server inside Claude Code, giving Claude full access to Discord with tools for memory, reminders, personas, and four optional plugins.

**Requirements:** [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (Max or Pro plan). No API key needed -- runs on your Claude subscription.

## Features

**Core**
- Discord channels, DMs, threads, embeds, polls, buttons
- Two-tier memory: core (always in context) + archival (searchable), auto-compaction
- Reminders with recurring (cron), nag mode, snooze, interactive buttons
- Switchable personas -- create and swap from Discord
- GitHub integration (PRs, issues, notifications)
- Permission relay -- approve tool use from Discord DMs
- Owner auto-detected, allowlist for other users

**Plugins** (enable/disable from Discord with `/plugins`)

| Plugin | Description |
|--------|-------------|
| **Voice** | Full-duplex voice chat. Local STT (whisper-cpp) + TTS (Kokoro), Silero VAD, multi-speaker, interruption handling, streaming |
| **Browser** | Web browsing via Playwright. Navigate, click, type, screenshot, evaluate JS |
| **Tutor** | Language learning with structured lessons, FSRS spaced repetition, quizzes. Japanese (JLPT N5-N1) included |
| **Socials** | YouTube search/transcripts, Reddit read/write, LinkedIn posting |

## Quick Start

### 1. Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) with a Max plan
- [Bun](https://bun.sh) (`brew install oven-sh/bun/bun`)
- A Discord bot token ([setup guide](docs/discord-setup.md))

### 2. Install & Run

```bash
git clone https://github.com/ANonABento/choomfie.git
cd choomfie
./install.sh    # installs deps, prompts for Discord token, adds 'choomfie' command
choomfie        # start!
```

For always-on (survives terminal close):

```bash
choomfie --tmux
```

### 3. Manual Setup

```bash
bun install
cp .env.example .env
# Edit .env — add DISCORD_TOKEN and DISCORD_CLIENT_ID

claude --plugin-dir /path/to/choomfie --dangerously-load-development-channels server:choomfie
```

> **Note:** `--plugin-dir` loads Choomfie for that session only. `--dangerously-load-development-channels` is required for Discord messages to reach Claude. Do NOT add it to global `~/.claude.json` mcpServers.

### 4. Access & Pairing

The bot **auto-detects the owner** from your Discord application. No manual pairing needed.

To add other users:
1. They DM the bot `!pair`
2. Copy the 5-letter code
3. Run `/choomfie:access pair <code>` in Claude Code
4. Run `/choomfie:access policy allowlist` to lock down

## Usage

In servers, `@mention` the bot or reply to its messages. In DMs, just talk -- no mention needed.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/remind` | Set a reminder (modal form) |
| `/reminders` | List active reminders |
| `/cancel <id>` | Cancel a reminder |
| `/memory [search]` | List or search memories |
| `/savememory` | Save a memory (modal form) |
| `/github <check>` | Check PRs, issues, notifications |
| `/status` | Bot status with uptime and stats |
| `/persona [switch]` | List or switch personas |
| `/newpersona` | Create a persona (modal form) |
| `/plugins` | List, enable, or disable plugins |
| `/voice` | Voice provider setup wizard |
| `/lesson` | Start a structured lesson |
| `/progress` | Show learning progress |
| `/help` | Show all commands |

### Claude Code Skills

| Skill | Description |
|-------|-------------|
| `/choomfie:configure <token>` | Set Discord bot token |
| `/choomfie:access` | Manage access (pair, list, add, remove, policy) |
| `/choomfie:memory` | View/manage memories |
| `/choomfie:status` | Full config overview |

## Architecture

```
Claude Code <-- MCP stdio --> supervisor.ts (immortal)
                                  |  Bun IPC
                              worker.ts (disposable)
                                  |
                    Discord + Plugins + Tools
```

- **Supervisor** owns the MCP connection. Never restarts.
- **Worker** owns Discord, plugins, and tools. Hot-reloadable via restart.
- Tool calls route through IPC. Notifications forward back to Claude.

See [docs/supervisor-architecture.md](docs/supervisor-architecture.md) for details.

## Plugin Setup

### Voice

Requires at least one STT and one TTS provider:

```bash
# Local (free, recommended)
brew install whisper-cpp           # STT
pip install kokoro-onnx soundfile  # TTS

# Or cloud (needs API keys in .env)
# GROQ_API_KEY=...       # Free STT
# ELEVENLABS_API_KEY=... # Paid STT + TTS
```

Configure via `/voice` slash command in Discord.

### Socials

**YouTube** -- Search and transcripts work out of the box (yt-dlp). Commenting requires Google Cloud OAuth.

**Reddit** -- Read works without config. Write requires a "script" app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps).

**LinkedIn** -- Requires an app at [developer.linkedin.com](https://www.linkedin.com/developers/apps):
1. Enable "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" products
2. Add redirect URL: `http://localhost:9876/callback`
3. Add client ID/secret to config.json under `socials.linkedin`
4. Run `linkedin_auth` (open the link on the same machine running the bot)

## Tools (38)

| Category | Tools |
|----------|-------|
| **Discord** | reply, react, edit_message, fetch_messages, search_messages, create_thread, create_poll, pin_message, unpin_message |
| **Memory** | save_memory, search_memory, list_memories, delete_memory, save_conversation_summary, memory_stats |
| **Personas** | switch_persona, save_persona, list_personas, delete_persona |
| **Reminders** | set_reminder, list_reminders, cancel_reminder, snooze_reminder, ack_reminder |
| **Access** | allow_user, remove_user, list_allowed_users |
| **Lessons** | lesson_status |
| **GitHub** | check_github |
| **Status** | choomfie_status |
| **System** | restart |

## Project Structure

```
server.ts              # Entry point
supervisor.ts          # Immortal MCP process
worker.ts              # Disposable Discord/plugin process
lib/                   # Core: discord, memory, reminders, tools, config, permissions
plugins/
  voice/               # Voice chat (STT/TTS/VAD)
  browser/             # Web browsing (Playwright)
  tutor/               # Language learning (FSRS, lessons, Japanese module)
  socials/             # YouTube, Reddit, LinkedIn
skills/                # Claude Code slash command skills
docs/                  # Setup guides, architecture, roadmap
```

## Docs

- [Discord Setup](docs/discord-setup.md) -- creating a Discord bot
- [Supervisor Architecture](docs/supervisor-architecture.md) -- system design
- [Voice Plugin](docs/voice-plugin.md) -- voice setup and optimization
- [Tutor Plugin](docs/tutor-plugin-spec.md) -- language learning system
- [Roadmap](docs/roadmap.md) -- planned features

## License

[MIT](LICENSE)
