# Memory System

Ryuji uses a two-tier memory system inspired by [Letta (MemGPT)](https://github.com/letta-ai/letta).

## Tiers

### Core Memory

Key-value pairs that are **always loaded into the agent's context**. This is the agent's "working memory" — things it should always know.

Examples:
- `name=Ben`
- `role=software engineer`
- `preferences=concise answers, casual tone`
- `current_project=building Ryuji`

**Storage:** `core_memory` table in SQLite. Small by design — aim for <20 entries.

### Archival Memory

Timestamped entries with tags. **Not loaded by default** — searched on demand. This is long-term storage for facts, conversation summaries, and learnings.

Examples:
- "User debugged a Next.js hydration issue on 2026-03-20" `[coding, nextjs]`
- "User prefers TypeScript over JavaScript" `[preferences]`
- "Ryuji learned that claude --print doesn't support streaming" `[technical, limitations]`

**Storage:** `archival_memory` table in SQLite. Can grow large.

## How Memory Flows into Context

```
System Prompt:
┌─────────────────────────────────────────┐
│ You are Ryuji, a personal AI assistant. │
│                                         │
│ ## Memory                               │
│ - name: Ben                             │
│ - role: software engineer               │
│ - preferences: concise, casual          │
│                                         │
│ ## Available Skills                     │
│ - web_search: Search the web            │
│ - ...                                   │
└─────────────────────────────────────────┘
```

Core memory is injected every time. Archival memory is only included when the agent searches for it.

## Terminal Commands

```bash
# View all core memories
ryuji> /memory

# Save a core memory
ryuji> /remember name=Ben
ryuji> /remember timezone=PST

# The agent can also update memory itself (planned)
ryuji> remember that I prefer dark mode
```

## API (for skill authors)

```typescript
import { MemoryStore } from "../memory/store.js";

const memory = new MemoryStore();

// Core memory
memory.setCoreMemory("name", "Ben");
memory.getCoreMemory(); // [{ key: "name", value: "Ben", updatedAt: "..." }]
memory.deleteCoreMemory("name");

// Archival memory
memory.addArchival("User likes ramen", "food, preferences");
memory.searchArchival("ramen"); // [{ id: 1, content: "...", tags: "...", createdAt: "..." }]

// Build context string for agent
memory.buildMemoryContext(); // "## Memory\n- name: Ben\n..."
```

## Planned Improvements

- **Agent self-editing memory** — the agent can call `setCoreMemory` / `addArchival` during conversations, like Letta's self-editing approach
- **Vector search** — replace LIKE queries with embeddings for semantic archival search
- **Memory decay** — auto-archive old core memories that haven't been accessed
- **Conversation summarization** — auto-summarize long conversations into archival entries
- **Cross-session recall** — agent searches archival memory when context seems relevant
