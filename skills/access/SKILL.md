---
name: access
description: Manage Ryuji Discord access — approve pairings, view/edit the allowlist.
user-invocable: true
argument-hint: <pair CODE | list | add USER_ID | remove USER_ID | policy allowlist|open>
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

Manage who can message Ryuji on Discord.

The access file is at `~/.claude/channels/ryuji/access.json` with format:
```json
{
  "policy": "allowlist",
  "allowed": ["discord_user_id_1", "discord_user_id_2"]
}
```

Handle $ARGUMENTS:

**`pair <CODE>`** — Approve a pending pairing. The user DMs the Discord bot `!pair`, gets a 5-letter code, then runs this command. Look up the code, add the user ID to the allowlist, and save.

**`list`** — Show all allowed user IDs.

**`add <USER_ID>`** — Add a Discord user ID to the allowlist.

**`remove <USER_ID>`** — Remove a Discord user ID from the allowlist.

**`policy allowlist`** — Only allowlisted users can message (recommended).

**`policy open`** — Anyone can message (not recommended, prompt injection risk).

Always create the directory and file if they don't exist. After changes, tell the user to restart Claude Code for changes to take effect.
