# Skills

Skills are slash commands you run in the Claude Code terminal.

## Built-in Skills

### `/ryuji:configure <token>`

Set your Discord bot token. Saves to `~/.claude/channels/ryuji/.env`.

### `/ryuji:access <command>`

Manage who can message Ryuji on Discord.

```
/ryuji:access pair <code>          # Approve a pairing code
/ryuji:access list                 # Show allowed users
/ryuji:access add <user_id>       # Add user by Discord ID
/ryuji:access remove <user_id>    # Remove user
/ryuji:access policy allowlist    # Only allow paired users
/ryuji:access policy open         # Allow anyone (not recommended)
```

### `/ryuji:memory [command]`

View and manage persistent memories.

```
/ryuji:memory                      # List core memories (default)
/ryuji:memory list                 # Same
/ryuji:memory search <query>       # Search archival memory
/ryuji:memory set <key>=<value>    # Set a core memory
/ryuji:memory delete <key>         # Delete a core memory
/ryuji:memory export               # Export all memories as JSON
/ryuji:memory clear                # Clear all (asks for confirmation)
```

### `/ryuji:status`

Full config overview — memory stats, personality, access policy, all features, how to change everything. This reads the actual database and config files.

## Creating Custom Skills

Add a folder under `skills/` with a `SKILL.md`:

```
skills/
└── my-skill/
    └── SKILL.md
```

```markdown
---
name: my-skill
description: Does something cool.
user-invocable: true
argument-hint: <arg>
allowed-tools:
  - Read
  - Bash(echo *)
---

Instructions for Claude. $ARGUMENTS contains user input.
```

## Skills vs MCP Tools

- **Skills** = terminal slash commands (run by user in Claude Code)
- **MCP Tools** = functions Claude calls during conversations (reply, save_memory, etc.)

Most things are available as both — ask on Discord or use the skill in terminal.
