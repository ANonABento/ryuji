# Choomfie Hermes Setup

Choomfie is moving to a Hermes-based distribution model.

## Platform Support

| Platform | Status |
| --- | --- |
| Linux | First-class target. |
| macOS | Supported. |
| Windows via WSL | Supported like Linux. |
| Native Windows | Not supported by Choomfie's Bash launchers yet. Use WSL. |

## Linux Laptop Setup

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

Fedora:

```bash
sudo dnf install -y git curl ca-certificates
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
```

Then:

```bash
git clone https://github.com/ANonABento/choomfie.git
cd choomfie
./install.sh
nano ~/.choomfie-hermes/.env
choomfie doctor
choomfie
```

## New Default

```bash
./install.sh
choomfie
```

This now means:

```text
choomfie
  -> Choomfie launcher
  -> local Hermes checkout
  -> Choomfie overlay synced into ~/.choomfie-hermes
  -> hermes gateway run
  -> Discord/API/cron/skills/memory
```

It no longer launches Claude Code by default.

## Filesystem Shape

```text
choomfie/
  install.sh
  bin/
    choomfie                 # new Hermes-based launcher
    choomfie-legacy          # old Claude Code/Bun launcher
  legacy/bun/
    packages/
    plugins/
  hermes-overlay/
    distribution.yaml
    SOUL.md
    config.yaml
    .env.EXAMPLE
    profiles/SOUL.md
    skills/
    plugins/
    toolsets/
    scripts/

~/.local/share/choomfie/hermes/
  upstream Hermes checkout

~/.choomfie-hermes/
  live Choomfie-Hermes home
  .env
  config.yaml
  SOUL.md
  skills/
  plugins/
  toolsets/
```

## Install Script

`./install.sh` does this:

1. Checks for `git`, `curl`, and `uv`.
2. Clones or updates Hermes into `~/.local/share/choomfie/hermes`.
3. Creates `~/.choomfie-hermes`.
4. Syncs the Choomfie overlay into that home.
5. Creates `~/.choomfie-hermes/.env` and `config.yaml` if missing.
6. Imports a legacy Discord token if one exists.
7. Installs `choomfie` and `choomfie-legacy` into `~/.local/bin`.

It does not require Claude Code for the new default path.

The overlay is also shaped as a native Hermes profile distribution:

```bash
choomfie hermes profile install "$PWD/hermes-overlay" --name choomfie --force -y
```

The local launcher still uses `sync-overlay.sh` because it keeps `~/.choomfie-hermes` simple and predictable during migration.

## Commands

```bash
choomfie                  # start Hermes gateway/API foreground
choomfie --tmux           # start gateway/API in tmux
choomfie chat             # terminal chat with Choomfie-Hermes
choomfie hermes version   # pass through to Hermes
choomfie sync             # resync overlay into ~/.choomfie-hermes
choomfie doctor           # check setup
choomfie update           # update Hermes checkout and sync overlay
choomfie legacy           # old Claude Code/Bun runtime
choomfie-legacy           # same legacy runtime directly
```

## Required Configuration

Before a real Discord run, edit:

```bash
~/.choomfie-hermes/.env
```

Set at least:

```bash
API_SERVER_KEY=change-this-to-a-long-random-secret
DISCORD_TOKEN=your-discord-bot-token
```

Then configure a model provider supported by Hermes, for example:

```bash
OPENROUTER_API_KEY=...
```

or use Hermes' own setup/model commands:

```bash
choomfie hermes setup
choomfie hermes model
```

## Legacy Path

Old Choomfie is still available:

```bash
choomfie legacy
choomfie legacy --tmux
choomfie legacy --daemon
```

That path still uses:

```text
claude --plugin-dir . --dangerously-load-development-channels server:choomfie
```

Keep it around until Hermes-native Discord, tutor, memory, and voice behavior are proven.
