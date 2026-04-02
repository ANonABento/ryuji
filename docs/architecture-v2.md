# Architecture V2: Daemon Mode

## Status: Planning — Last Updated 2026-03-30

## TL;DR

```
Daemon (daemon.ts) — always running, manages everything
  ├→ Claude Session (Agent SDK) — the brain, cycled when context heavy
  └→ Discord Worker (worker.ts) — hands and feet, talks to Discord
```

## Role Matrix

| Layer | Process | Lifecycle | Responsibilities | Owns |
|-------|---------|-----------|-----------------|------|
| **Daemon** | `daemon.ts` (Bun) | Immortal (systemd/launchd) | Spawn + cycle Claude sessions. Spawn + restart Discord worker. Route messages between Claude ↔ Worker. Monitor context usage. Handoff summaries. PID guard. Health checks. | Session lifecycle, worker lifecycle, message routing, state persistence |
| **Claude Session** | Agent SDK subprocess | Disposable (cycled every ~120K tokens) | Process messages. Reason about what to do. Decide which tools to call. Generate responses. Maintain conversation context. Follow persona. | LLM reasoning, tool selection, conversation memory (ephemeral) |
| **Discord Worker** | `worker.ts` (Bun) | Disposable (restartable) | Discord client connection. Plugin runtime (voice, browser, socials, language-learning). Execute tool calls (reply, react, browse, speak, etc.). Handle interactions (buttons, slash commands, modals). Reminders. | Discord connection, plugin state, tool execution, real-time features |

## What Each Layer Does NOT Do

| Layer | Does NOT |
|-------|----------|
| **Daemon** | Does NOT reason about messages. Does NOT call tools directly. Does NOT talk to Discord. |
| **Claude Session** | Does NOT persist across restarts. Does NOT manage Discord. Does NOT survive context overflow. |
| **Discord Worker** | Does NOT decide what to say. Does NOT manage Claude. Does NOT handle context/sessions. |

## Current Architecture (V1)

```
Claude Code (terminal session, manages context)
  └→ Supervisor (packages/core/server.ts — immortal, MCP stdio, PID guard)
       └→ Worker (packages/core/worker.ts — disposable, Discord + plugins + tools)
```

**Why 3 layers exist:**
- Claude Code: hosts the LLM, manages conversation
- Supervisor: keeps MCP pipe alive through worker restarts
- Worker: disposable, can be killed/respawned for code reload

**Problem:** Claude Code is unmanaged. Context grows until it degrades. No automatic cycling.

## Proposed Architecture (V2)

```
Daemon (packages/core/daemon.ts — immortal, always running)
  ├→ Claude Session (Agent SDK — managed, cycled when context heavy)
  │    └→ Choomfie tools registered via plugin or direct
  └→ Discord Worker (packages/core/worker.ts — disposable, Discord + plugins)
       └→ IPC back to Daemon
```

### Key Insight

The current supervisor's ONLY job is keeping the MCP pipe alive. If daemon manages Claude sessions via the Agent SDK, there IS no MCP pipe to keep alive — the SDK handles the Claude connection internally. The MCP layer becomes unnecessary.

### What Each Layer Does

**Daemon (daemon.ts):**
- Always running (spawned by systemd, launchd, or a shell script)
- Spawns + manages Claude sessions via Agent SDK
- Spawns + manages Discord worker via Bun.spawn + IPC
- Routes Discord messages → Claude session
- Routes Claude tool calls → Worker for execution
- Monitors context usage, cycles sessions when needed
- Handles handoff summaries between sessions
- PID guard (single instance)

**Discord Worker (worker.ts):**
- Owns Discord client, plugins, interactions
- Executes tool calls (reply, react, browse, voice, etc.)
- Reports events (messages, voice transcripts) back to daemon via IPC
- Disposable — daemon can kill and respawn for code reload
- Same as current worker, but IPC goes to daemon instead of MCP supervisor

### What We Remove

- `packages/core/supervisor.ts` — no longer needed. Meta-supervisor handles both Claude and worker lifecycle.
- MCP stdio transport — replaced by Agent SDK's programmatic interface.
- MCP server creation — tools registered directly with the Agent SDK.

### What We Keep

- `packages/core/worker.ts` — same Discord worker, same plugins, same tools. Just different IPC parent.
- All plugin packages in `plugins/` (voice, browser, tutor, socials) — unchanged.
- All tool definitions — unchanged, but registered differently.

## Communication

| From → To | Channel | Data |
|-----------|---------|------|
| Worker → Meta | IPC (Bun.spawn) | Discord messages, voice transcripts, interaction events |
| Meta → Claude | Agent SDK (stdin stream) | User messages, tool results, system prompts |
| Claude → Meta | Agent SDK (stdout stream) | Responses, tool calls, token usage |
| Meta → Worker | IPC (Bun.spawn) | Tool calls to execute (reply, browse, etc.) |
| Worker → Meta | IPC | Tool results (message sent, screenshot path, etc.) |

## Lifecycle Events

| Event | Who Handles | What Happens |
|-------|-------------|--------------|
| Bot startup | Daemon | Spawns Claude session + Discord worker |
| Discord message | Worker → Meta → Claude | Routed to Claude for processing |
| Tool call | Claude → Meta → Worker | Worker executes, returns result |
| Context full (~120K) | Daemon | Drains, generates summary, cycles Claude session |
| Worker crash | Daemon | Respawns worker, Claude session unaffected |
| Claude session error | Daemon | Respawns session with last handoff summary |
| Code update / restart | Daemon | Kills worker, spawns fresh one. Optionally cycles Claude session. |
| Shutdown | Daemon | Graceful shutdown of Claude session + worker |

## Flow Comparison

### V1: Discord Message → Claude Response

```
Discord message
  → Worker receives via discord.js
  → Worker sends IPC notification to Supervisor
  → Supervisor forwards as MCP notification to Claude Code
  → Claude Code processes, decides to call reply tool
  → Claude Code sends MCP tool call to Supervisor
  → Supervisor forwards IPC tool_call to Worker
  → Worker executes reply via discord.js
  → Worker sends IPC tool_result to Supervisor
  → Supervisor forwards result to Claude Code
```
**Hops: 8**

### V2: Discord Message → Claude Response

```
Discord message
  → Worker receives via discord.js
  → Worker sends IPC to Daemon
  → Daemon feeds message to Claude session (Agent SDK)
  → Claude processes, returns tool call in stream
  → Daemon sends IPC tool_call to Worker
  → Worker executes reply via discord.js
  → Worker sends IPC tool_result to Daemon
  → Daemon feeds result back to Claude session
```
**Hops: 6** (eliminates MCP protocol overhead)

## Tool Registration in V2

### Option A: Plugin directory (simplest)

Agent SDK supports `--plugin-dir`. Tools are still registered via MCP, but the SDK manages the MCP connection internally. This means we could keep the current supervisor as the MCP server inside the plugin, or...

### Option B: Direct tool registration

The Agent SDK's `allowedTools` option controls which tools Claude can use. We could register tools directly:

```typescript
query({
  prompt: messageGenerator,
  options: {
    allowedTools: [
      // Built-in Claude Code tools
      "Read", "Edit", "Bash",
      // Custom tools registered via... ?
    ]
  }
});
```

**Problem:** The Agent SDK doesn't have a direct "register custom tool" API. Tools come from MCP servers loaded via `--mcp-config` or plugins. So we'd still need SOME MCP server to expose our tools.

### Option C: Hybrid (Recommended)

Keep the current supervisor as an MCP server, but spawn it as a local MCP server config instead of the entry point:

```typescript
query({
  prompt: messageGenerator,
  options: {
    mcpServers: {
      choomfie: {
        command: "bun",
        args: ["server.ts"], // existing supervisor, but now spawned BY daemon
      }
    }
  }
});
```

This way:
- Meta-supervisor spawns Claude session
- Claude session spawns supervisor as MCP server
- Supervisor spawns worker as before
- But daemon controls session lifecycle

**Downside:** We're back to 4 layers. But session cycling is managed.

### Option D: Collapse supervisor into worker

Make the worker ALSO be the MCP server. Remove the supervisor entirely:

```typescript
// daemon.ts
query({
  prompt: messageGenerator,
  options: {
    mcpServers: {
      choomfie: {
        command: "bun",
        args: ["worker-mcp.ts"], // combined worker + MCP server
      }
    }
  }
});
```

`worker-mcp.ts` would:
- Run the MCP server (stdio transport to Claude via SDK)
- Run the Discord client
- Run all plugins
- Handle tool calls directly (no IPC routing)

**On restart:** Meta-supervisor cycles the Claude session (which restarts the MCP server, which restarts the worker). Fresh context + fresh code.

**Downside:** Worker restarts also restart the MCP connection and Claude session. But if daemon handles cycling anyway, this is fine — the whole point is that sessions are disposable.

## Design Decisions

### Worker is a sibling, not a child
Meta-supervisor spawns BOTH Claude session and worker directly. They're siblings, not nested. This means cycling Claude does NOT kill the worker — Discord stays connected.

```
Daemon
  ├→ Claude Session (can be cycled independently)
  └→ Worker (stays alive during session cycles)
```

### Message bus over direct IPC
Instead of point-to-point routing, use a simple event emitter inside daemon. Worker publishes events ("discord_message", "voice_transcript"), daemon subscribes and routes to Claude. Makes it easy to add consumers later (logging, analytics, parallel sessions).

### Model routing at the meta level
Meta-supervisor sees every message before Claude. Could route simple messages (reactions, short replies) to Haiku and complex ones to Opus via SDK's `setModel()`. Not for Phase 1, but the architecture supports it naturally.

### No fallback during session cycling
Session swap takes ~12s. During this time, Discord messages queue in daemon and replay when the new session is ready. No special "degradation mode" needed — the queue handles it.

### Keep supervisor in Phase 1
Don't refactor the current supervisor/worker system yet. Phase 1 wraps the existing architecture. Prove session cycling works first. Collapse later.

## Open Questions

1. **Can the Agent SDK load plugins that register MCP tools?** If yes, Option A is simplest.
2. **What's the latency of Agent SDK tool calls vs MCP?** If SDK adds overhead per tool call, it could affect voice responsiveness.
3. **Does the Discord bot stay connected during session cycling?** If the worker is spawned by Claude session (Option C/D), cycling kills the worker too. Need the worker to be independent.
4. **Do we need code reloading?** If the daemon always cycles Claude sessions (which respawn the worker), the current "restart tool" becomes a "cycle session" tool.

## Recommended Path Forward

**Phase 1: Meta-supervisor wrapper (don't refactor yet)**
- Build `daemon.ts` using Agent SDK
- Spawn current architecture as-is (supervisor as MCP plugin)
- Add session monitoring + cycling
- Validate everything works

**Phase 2: Harden daemon** ✅
- Fixed handoff summary capture (proper result-based extraction)
- Typed state (removed `as any` hacks)
- Error recovery with exponential backoff
- `--test-cycle` flag for end-to-end cycling verification
- `--benchmark` flag for latency measurement
- `--verbose` flag for debug output
- Context check fallback (turn-based after 5 failures)

**Phase 3: Supervisor collapse (Option A)** ✅
- Meta-supervisor adds worker health monitoring
- Worker stays managed by plugin system (supervisor spawns worker inside Claude session)
- Meta-supervisor detects worker failures via PID file health checks
- On worker death: triggers session cycle to respawn everything
- Session cycle tool replaces manual restart for context refresh
- Worker restarts on cycle (~3s Discord reconnect, acceptable tradeoff)
- Full worker-as-sibling architecture (Option B) deferred — only needed if 3s reconnect is unacceptable

**Phase 4 (future): Full sibling architecture**
- If 3s Discord reconnect on cycle is unacceptable:
  - Remove supervisor, spawn worker directly from daemon
  - Worker survives session cycles (Discord stays connected)
  - Custom MCP server in daemon exposes worker tools to Agent SDK

## Agent SDK Reference

```bash
bun add @anthropic-ai/claude-agent-sdk
```

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
    persistSession: true,
  }
});
```

### Session Cycling Protocol

**State machine:** `ACTIVE` → `DRAINING` → `CYCLING` → `ACTIVE`

1. **ACTIVE:** Normal operation. Track tokens/turns from SDK messages.
2. **DRAINING:** Threshold reached (~120K tokens or 80 turns). Queue new messages, wait for in-flight tool calls, generate handoff summary, store in SQLite.
3. **CYCLING:** Close old session (`query.close()`), start new one with summary as system prompt.
4. **ACTIVE:** Replay queued messages, resume.

### CLI Flags

```bash
claude \
  --input-format stream-json \
  --output-format stream-json \
  --permission-mode bypassPermissions \
  --plugin-dir /path/to/choomfie \
  --session-id <uuid> \
  --append-system-prompt "Handoff context: ..."
```

### Caveats

- ~12s overhead per new `query()` call — use streaming input to keep session alive
- No programmatic `/compact` — must cycle sessions instead
- `stream-json` stdin format poorly documented (GitHub #24594)
