# Skills

Ryuji ships with plugin skills — slash commands you run in the Claude Code terminal.

## Built-in Skills

### `/ryuji:configure <token>`

Set your Discord bot token. Saves to `~/.claude/channels/ryuji/.env`.

```bash
/ryuji:configure MTk2NjY3...your_token_here
```

### `/ryuji:access <command>`

Manage who can message Ryuji on Discord.

```bash
/ryuji:access pair abcde          # Approve a pairing code
/ryuji:access list                # Show allowed users
/ryuji:access add 123456789       # Add user by Discord ID
/ryuji:access remove 123456789    # Remove user
/ryuji:access policy allowlist    # Only allow paired users (recommended)
/ryuji:access policy open         # Allow anyone (not recommended)
```

### `/ryuji:memory <command>`

View and manage persistent memories.

```bash
/ryuji:memory                     # List core memories (default)
/ryuji:memory list                # Same as above
/ryuji:memory search typescript   # Search archival memory
/ryuji:memory set name=Ben        # Set a core memory
/ryuji:memory delete name         # Delete a core memory
/ryuji:memory export              # Export all memories as JSON
/ryuji:memory clear               # Clear all (asks for confirmation)
```

## How Skills Work

Skills are defined in `skills/<name>/SKILL.md` files. Each SKILL.md contains:

- **Frontmatter** — name, description, allowed tools, argument hints
- **Body** — instructions for Claude on how to execute the skill

When you run `/ryuji:skillname`, Claude reads the SKILL.md and follows its instructions. Skills can use Claude Code's built-in tools (Read, Write, Bash, etc.).

## Creating Custom Skills

Add a new folder under `skills/`:

```
skills/
└── my-skill/
    └── SKILL.md
```

Example `SKILL.md`:

```markdown
---
name: my-skill
description: Does something cool.
user-invocable: true
argument-hint: <required-arg> [optional-arg]
allowed-tools:
  - Read
  - Bash(echo *)
---

Instructions for Claude on what to do when this skill is invoked.

$ARGUMENTS contains what the user typed after the skill name.
```

## MCP Tools vs Skills

**Skills** = slash commands run in the Claude Code terminal by the user.
**MCP Tools** = functions Claude calls automatically during conversations (reply, save_memory, etc.).

Both are part of Ryuji, but they serve different purposes:
- Use skills for user-initiated config/management
- Use MCP tools for agent-initiated actions during chat
