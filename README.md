# Choomfie

A personal AI agent distribution layered on Hermes, with Choomfie-specific personality, skills, plugins, tutor behavior, Discord preferences, and local setup.

## What is this?

Choomfie is becoming a Hermes-based personal agent distribution. The new default launcher runs Hermes with the Choomfie overlay: personality/profile, skills, plugins, toolsets, Discord preferences, tutor behavior, and local setup.

The previous Claude Code/Bun runtime is still available as `choomfie legacy` while the migration is in progress.

**New default requirements:** `git`, `curl`, and [`uv`](https://docs.astral.sh/uv/), plus a Hermes-supported model provider key.

**Legacy requirements:** [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (Max or Pro plan).

## Features

**Hermes-first Core**
- Hermes gateway/API server for Discord and other platforms
- Hermes model/provider routing
- Choomfie profile/SOUL defaults
- Choomfie overlay skills/plugins/toolsets
- Hermes memory, cron, skills, subagents, and API server

**Legacy Bun Core** (`choomfie legacy`)
- Discord channels, DMs, threads, embeds, polls, buttons
- Two-tier memory: core (always in context) + archival (searchable), auto-compaction
- Reminders with recurring (cron), nag mode, snooze, interactive buttons
- Switchable personas -- create and swap from Discord
- GitHub integration (PRs, issues, notifications)
- Permission relay -- approve tool use from Discord DMs
- Owner auto-detected, allowlist for other users

**Legacy Plugins** (`choomfie legacy`, enable/disable from Discord with `/plugins`)

| Plugin | Description |
|--------|-------------|
| **Voice** | Full-duplex voice chat. Local STT (whisper-cpp) + TTS (Kokoro), Silero VAD, multi-speaker, interruption handling, streaming |
| **Browser** | Web browsing via Playwright. Navigate, click, type, screenshot, evaluate JS |
| **Tutor** | Language learning with structured lessons, FSRS spaced repetition, quizzes. Japanese (JLPT N5-N1) included |
| **Socials** | YouTube search/transcripts, Reddit read/write, LinkedIn posting |

## Quick Start

### 1. Linux Laptop Prerequisites

On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

On Fedora:

```bash
sudo dnf install -y git curl ca-certificates
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

You also need:

- A Hermes-supported model provider key, such as OpenRouter, Anthropic API, OpenAI, Google, or Ollama
- A Discord bot token ([setup guide](docs/discord-setup.md))

### 2. Install & Run

```bash
git clone https://github.com/ANonABento/choomfie.git
cd choomfie
./install.sh    # installs local Hermes checkout, syncs overlay, adds 'choomfie' command
```

Edit:

```bash
nano ~/.choomfie-hermes/.env
```

Set:

```bash
API_SERVER_KEY=change-this-to-a-long-random-secret
DISCORD_TOKEN=your-discord-bot-token
OPENROUTER_API_KEY=your-provider-key
```

Then:

```bash
choomfie doctor
choomfie
```

Modes:

```bash
choomfie              # Hermes gateway/API foreground
choomfie --tmux       # Hermes gateway/API in tmux
choomfie chat         # terminal chat with Choomfie-Hermes
choomfie doctor       # setup check
choomfie legacy       # old Claude Code/Bun runtime
```

See [Hermes Setup](docs/hermes-setup.md) for the new launcher, filesystem layout, and config flow.

### Platform Support

| Platform | Status |
| --- | --- |
| Linux | First-class target. |
| macOS | Supported. |
| Windows via WSL | Supported like Linux. |
| Native Windows | Not yet; use WSL for now. |

### 3. Legacy Manual Setup

```bash
bun install
claude --plugin-dir . --dangerously-load-development-channels server:choomfie
# On first run, use /choomfie:configure <token> to set your Discord bot token
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

**Interactive mode** (`choomfie`):
```
Claude Code <-- MCP stdio --> supervisor.ts (immortal)
                                  |  Bun IPC
                              worker.ts (disposable)
                                  |
                    Discord + Plugins + Tools
```

**Daemon mode** (`choomfie --daemon`):
```
daemon.ts (immortal, Agent SDK)
  └→ Claude Session (disposable, auto-cycled)
       └→ supervisor.ts → worker.ts → Discord
```

- **Interactive**: you get a Claude Code terminal + Discord. Supervisor keeps MCP alive through worker restarts.
- **Daemon**: Discord-only, no terminal. Sessions auto-cycle at ~120K tokens with handoff summaries.

Legacy architecture details live under [docs/legacy/bun](docs/legacy/bun/).

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

## Tools (42)

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

Choomfie is now organized around a Hermes overlay, with the previous Bun runtime isolated under `legacy/bun/`:

```
bin/                               # Choomfie launchers
  choomfie                         # Hermes-first launcher
  choomfie-legacy                  # Old Claude Code/Bun launcher
hermes-overlay/                    # Choomfie distribution layer for Hermes
  profiles/
  skills/
  plugins/
  toolsets/
  scripts/
legacy/bun/                        # Previous Choomfie runtime
  packages/
    shared/                        # @choomfie/shared — types, utils, time, paths
    core/                          # @choomfie/core — MCP server, Discord bridge, memory
  plugins/
    voice/                         # @choomfie/voice — STT/TTS/VAD
    browser/                       # @choomfie/browser — Playwright browsing
    tutor/                         # @choomfie/tutor — language learning
    socials/                       # @choomfie/socials — YouTube, Reddit, LinkedIn
docs/                              # Setup guides, architecture, migration docs
```

## Docs

- [Discord Setup](docs/discord-setup.md) -- creating a Discord bot
- [Hermes Setup](docs/hermes-setup.md) -- new default setup and launcher flow
- [Hermes Migration Plan](docs/hermes-migration-plan.md) -- phased migration plan
- [Hermes Tutor Port](docs/hermes-tutor-port.md) -- tutor vertical-slice plan
- [Legacy Bun Docs](docs/legacy/bun/README.md) -- previous Claude Code/Bun runtime docs

## License

[MIT](LICENSE)
