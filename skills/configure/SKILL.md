---
name: configure
description: Configure Choomfie with your Discord bot token.
user-invocable: true
argument-hint: <discord-bot-token>
allowed-tools:
  - Write
  - Bash(mkdir *)
---

Save the user's Discord bot token so Choomfie can connect to Discord.

The token should be saved to `~/.claude/channels/choomfie/.env` in the format:
```
DISCORD_TOKEN=<token>
```

Steps:
1. Take the token from $ARGUMENTS
2. Create the directory `~/.claude/channels/choomfie/` if it doesn't exist
3. Write the token to `~/.claude/channels/choomfie/.env`
4. Tell the user to restart Claude Code with `claude --channels plugin:choomfie` for the change to take effect
