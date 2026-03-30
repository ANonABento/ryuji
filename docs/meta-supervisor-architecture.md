# Meta-Supervisor Architecture

A higher-level supervisor that manages Claude Code sessions themselves — spawning, monitoring, cycling, and replacing sessions when context gets heavy.

## Problem

- Claude Code sessions accumulate context (150K+ tokens in long conversations)
- No way to compact/reset without restarting the session
- Restarting drops the MCP connection (Discord bot restarts)
- Need automated session lifecycle management

## Solution: Agent SDK + Meta-Supervisor

### Architecture

```
Meta-Supervisor (Bun, always running)
  ├── Claude Session Manager
  │     ├── Active Session (Agent SDK query() with streaming input)
  │     │     └── Choomfie Plugin (MCP via --plugin-dir)
  │     │           └── supervisor.ts → IPC → worker.ts → Discord
  │     ├── Token/Turn Monitor (tracks context usage)
  │     └── Session Cycler (graceful transition logic)
  └── Message Router (Discord messages → active Claude session)
```

### Key Technology: `@anthropic-ai/claude-agent-sdk`

```bash
bun add @anthropic-ai/claude-agent-sdk
```

**Streaming input mode** keeps a long-lived session with bidirectional communication:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const session = query({
  prompt: messageGenerator, // AsyncGenerator yields messages on demand
  options: {
    model: "claude-sonnet-4-6",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    plugins: [{ directory: "/path/to/choomfie" }],
    systemPrompt: { type: "preset", preset: "claude_code", append: handoffSummary },
    includePartialMessages: true,
    persistSession: true,
    settingSources: ["project"],
  }
});
```

### Session Cycling Protocol

**State machine:** `ACTIVE` → `DRAINING` → `CYCLING` → `ACTIVE`

1. **ACTIVE:** Normal operation. Track tokens/turns from SDK messages.
2. **DRAINING:** Threshold reached (~120K tokens or 80 turns).
   - Stop accepting new Discord messages (queue them)
   - Wait for in-flight tool calls to complete
   - Ask Claude to generate handoff summary
   - Store summary in SQLite
3. **CYCLING:** Close old session, start new one.
   - `query.close()` on old session
   - Start new `query()` with summary as system prompt
   - First message: "You are resuming from a previous session. Here is context: [summary]"
4. **ACTIVE:** Replay queued messages, resume normal operation.

### Context Fullness Detection

- SDK messages include token usage metadata
- Track cumulative input tokens and turn count
- Threshold: cycle at ~120K tokens or ~80 turns (leave headroom before 200K limit)
- Alternative: track `total_cost_usd` as a proxy

### Handoff Summary

Before cycling, ask Claude to generate:
```
Summarize your current state:
- Active conversations (who, what channel, what topic)
- Pending tasks or promises made
- Recent decisions and context
- Current persona and mood
- Any important user preferences learned
```

Store in SQLite `handoff_summaries` table. Inject into new session's system prompt.

### Integration with Existing Architecture

The existing supervisor/worker system handles Discord stability:
- Supervisor keeps MCP connection alive through worker restarts
- Worker handles Discord + plugins

The meta-supervisor wraps Claude Code, not the MCP connection:
- Meta-supervisor cycles Claude Code sessions
- Each session loads Choomfie as a plugin
- Supervisor/worker continue operating through session cycles
- Discord stays connected the entire time

### CLI Flags for Programmatic Spawning

```bash
claude \
  --input-format stream-json \
  --output-format stream-json \
  --permission-mode bypassPermissions \
  --plugin-dir /path/to/choomfie \
  --session-id <uuid> \
  --append-system-prompt "Handoff context: ..." \
  --include-partial-messages \
  --max-budget-usd 5.0
```

### V2 SDK API (Preview, Simpler)

```typescript
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

const session = unstable_v2_createSession({ model: "claude-sonnet-4-6" });
await session.send("Discord message from user");
for await (const msg of session.stream()) { /* process */ }
// Later:
await session.send("Another message");
session.close();
```

### Caveats

- **~12s overhead per new `query()` call** — use streaming input to keep one session alive, only cycle when needed
- **No programmatic /compact** — can't trigger compaction from outside. Must cycle sessions instead.
- **Plugin reload** — each new session reloads the plugin, which means a worker restart. Existing supervisor handles this gracefully.
- **stream-json stdin format** is poorly documented (GitHub issue #24594)

### Existing Projects for Reference

- **ArgusBot** (github.com/waltstephen/ArgusBot) — Python supervisor, 3-agent loop, session persistence, stall watchdog
- **claude-code-supervisor** (github.com/guyskk/claude-code-supervisor) — Stop Hook for review cycles
- **claudebox** (github.com/RchGrav/claudebox) — Docker environment with persistence

### Implementation Priority

1. **Phase 1:** Basic meta-supervisor with Agent SDK — spawn session, route messages, no cycling
2. **Phase 2:** Token monitoring — track context usage, log warnings
3. **Phase 3:** Session cycling — handoff summaries, graceful transition
4. **Phase 4:** Health monitoring — stall detection, automatic recovery
5. **Phase 5:** Multi-session — parallel sessions for different tasks (chat vs tools)

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Agent SDK (recommended)** | Full control, typed API, session management | ~12s per new query, SDK is new |
| **Direct CLI subprocess** | Simple, no SDK dependency | Poor stdin protocol docs, manual parsing |
| **Anthropic API directly** | Full control, server-side compaction | Lose MCP, tools, hooks, CLAUDE.md |
| **tmux + manual** | Zero code | No automation, degrades when context fills |
| **--resume flag** | Continue old sessions | Doesn't help with context bloat |
