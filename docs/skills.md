# Skills System

Skills are pluggable tools that extend what Ryuji can do. They're registered at startup and listed in the agent's system prompt.

## Creating a Skill

```typescript
// src/skills/examples/timer.ts
import { registerSkill } from "../registry.js";

registerSkill({
  name: "set_timer",
  description: "Set a timer for N minutes. Args: { minutes: number, label: string }",
  execute: async (args) => {
    const { minutes, label } = args as { minutes: number; label: string };
    setTimeout(() => {
      console.log(`\n⏰ Timer "${label}" is done!\n`);
    }, minutes * 60 * 1000);
    return `Timer "${label}" set for ${minutes} minutes.`;
  },
});
```

## Registering Skills

Import your skill file in `src/index.ts`:

```typescript
import "./skills/examples/timer.js";
```

Skills are automatically listed in the agent's system prompt via `buildSkillsPrompt()`.

## Skill Interface

```typescript
interface Skill {
  name: string;          // unique identifier (snake_case)
  description: string;   // shown to the agent so it knows when to use it
  execute: (args: Record<string, unknown>) => Promise<string>;
}
```

## Built-in Skills (Planned)

| Skill | Description | Status |
|-------|-------------|--------|
| `web_search` | Search the web via MCP | Planned |
| `read_file` | Read a local file | Planned |
| `write_file` | Write/create a file | Planned |
| `run_command` | Execute a shell command | Planned |
| `set_timer` | Set a reminder timer | Planned |
| `manage_memory` | Let the agent edit its own memory | Planned |
| `schedule_task` | Schedule a recurring task | Planned |
| `browse_url` | Fetch and summarize a URL | Planned |

## How Skills Work with Claude Code

Since Ryuji runs on Claude Code CLI, the agent already has access to file editing, code execution, and MCP servers natively. Skills are for **additional capabilities** that aren't part of Claude Code's built-in toolset, or for **wrapping complex operations** into simple interfaces.

For example, Claude Code can already edit files — but a `deploy` skill could wrap `git push` + CI check + notification into one command.

## Skill Discovery

Skills describe themselves to the agent via the system prompt:

```
## Available Skills
- set_timer: Set a timer for N minutes
- deploy: Deploy the current branch to staging
- search_memory: Search archival memory for relevant context
```

The agent sees this list and can decide when to use each skill based on the user's request.
