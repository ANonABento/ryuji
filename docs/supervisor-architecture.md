# Supervisor Architecture

> Subprocess-based architecture for Choomfie.

## The Problem

Choomfie runs **inside** Claude Code as an MCP plugin. Claude Code talks to it over **stdio** (stdin/stdout). If the bot crashes or you want to reload code, the MCP connection dies — Claude Code loses the plugin and you have to restart your whole session.

The supervisor/worker split solves this: **the process Claude talks to never dies**, even when the Discord bot crashes or restarts.

## The Big Picture

```
┌─────────────────────────────────────────────────────────┐
│                     Claude Code                          │
│                                                          │
│  "Hey Choomfie, send a message to Discord"               │
│                                                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     │  stdio (stdin/stdout)
                     │  MCP protocol (JSON-RPC)
                     │
┌────────────────────▼────────────────────────────────────┐
│              SUPERVISOR  (supervisor.ts)                  │
│                                                          │
│  ✦ IMMORTAL — never restarts                             │
│  ✦ Owns the MCP server (the stdin/stdout connection)     │
│  ✦ Owns the "restart" tool                               │
│  ✦ Routes tool calls down, notifications up              │
│  ✦ Auto-respawns worker on crash                         │
│                                                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     │  Bun IPC (process.send / process.on("message"))
                     │  JSON messages, bidirectional
                     │
┌────────────────────▼────────────────────────────────────┐
│                WORKER  (worker.ts)                        │
│                                                          │
│  ✦ DISPOSABLE — can be killed and respawned              │
│  ✦ Owns Discord connection                               │
│  ✦ Owns all 49 tools (reply, react, memory, etc.)        │
│  ✦ Owns plugins (voice, browser, language-learning)      │
│  ✦ Owns reminders, config, permissions                   │
│                                                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     │  discord.js WebSocket
                     │
┌────────────────────▼────────────────────────────────────┐
│                   Discord                                │
└─────────────────────────────────────────────────────────┘
```

## How a Tool Call Flows

When Claude wants to do something (e.g. send a Discord message):

```
Claude Code                Supervisor              Worker               Discord
    │                          │                      │                     │
    │  ── MCP tool_call ──►    │                      │                     │
    │     "reply"              │                      │                     │
    │                          │  ── IPC tool_call ──►│                     │
    │                          │     id: "42"         │                     │
    │                          │     name: "reply"    │                     │
    │                          │                      │  ── API call ──►    │
    │                          │                      │     send message    │
    │                          │                      │                     │
    │                          │                      │  ◄── success ──     │
    │                          │  ◄── IPC result ──   │                     │
    │                          │     id: "42"         │                     │
    │  ◄── MCP result ──       │                      │                     │
    │     "Message sent"       │                      │                     │
```

## How a Discord Message Reaches Claude

When someone messages the bot on Discord, it flows in reverse:

```
Discord              Worker                Supervisor           Claude Code
   │                    │                      │                     │
   │  ── message ──►    │                      │                     │
   │    "@bot hi"       │                      │                     │
   │                    │  ── IPC notify ──►    │                     │
   │                    │    "new message"      │                     │
   │                    │                       │  ── MCP notify ──►  │
   │                    │                       │    "user said hi"   │
   │                    │                       │                     │
   │                    │                       │    Claude thinks... │
   │                    │                       │                     │
   │                    │                       │  ◄── tool_call ──   │
   │                    │  ◄── IPC tool_call ── │    "reply: hey!"   │
   │  ◄── API call ──   │                      │                     │
   │    send reply      │  ── IPC result ──►    │                     │
   │                    │                       │  ── MCP result ──►  │
```

## The Restart Flow

This is where the architecture really pays off:

```
Claude Code            Supervisor                  Worker (old)      Worker (new)
    │                      │                           │
    │  ── "restart" ──►    │                           │
    │                      │  ── IPC "shutdown" ──►    │
    │                      │                           │ cleanup...
    │                      │                           │ discord.destroy()
    │                      │                           │ plugins.destroy()
    │                      │                           X (exits)
    │                      │
    │                      │  Bun.spawn("worker.ts")          │
    │                      │  ─────────────────────────────►   │
    │                      │                                   │ loads config
    │                      │                                   │ loads plugins
    │                      │                                   │ connects Discord
    │                      │                                   │ schedules reminders
    │                      │  ◄── IPC "ready" (49 tools) ──   │
    │                      │
    │                      │  ── MCP "tools/list_changed" ──►  │
    │  ◄── "Restarted" ── │                                    │
    │                      │                                    │
    │  (MCP connection     │                                    │
    │   never broke!)      │                                    │
```

The key insight: **Claude Code never knew anything happened.** The stdio pipe stayed open the whole time. It just got a notification that the tool list changed (in case new plugins were enabled) and carried on.

## Crash Recovery

If the worker dies unexpectedly:

```
Supervisor                           Worker
    │                                   │
    │                                   X  (crash! non-zero exit)
    │
    │  crashCount++ (1/5)
    │  wait 1 second...
    │
    │  Bun.spawn("worker.ts")            │ (new worker)
    │  ──────────────────────────────►    │
    │                                     │ boots up...
    │  ◄── IPC "ready" ──                │
    │
    │  (If it crashes again: 2s, 4s, 8s, 15s backoff)
    │  (After 5 crashes in 60s: gives up)
```

## Startup Sequence

```
server.ts
  │
  └─► import "./supervisor.ts"
        │
        ├─ 1. Acquire PID file (kill old instance if running)
        ├─ 2. Bun.spawn("worker.ts") with IPC
        │       │
        │       ├─ createContext() — env, config, memory, access list
        │       ├─ loadPlugins() — voice, browser, language-learning
        │       ├─ McpProxy() — fake MCP server for IPC forwarding
        │       ├─ createDiscordClient() — sets up event handlers
        │       ├─ discord.login() — connects to Discord gateway
        │       ├─ await ClientReady — plugins init, reminders load, commands deploy
        │       └─ process.send({ type: "ready", tools, instructions })
        │
        ├─ 3. Wait for worker "ready" (up to 30s)
        ├─ 4. Create MCP server with real tools + instructions
        └─ 5. Connect stdio transport — Claude Code can now talk to us
```

## IPC Protocol

The supervisor and worker talk using typed JSON messages over Bun's built-in IPC:

```
        Worker → Supervisor                Supervisor → Worker
    ┌──────────────────────┐          ┌──────────────────────┐
    │ ready                │          │ tool_call            │
    │   tools: [...]       │          │   id: "42"           │
    │   instructions: "..."│          │   name: "reply"      │
    ├──────────────────────┤          │   args: {...}        │
    │ tool_result          │          ├──────────────────────┤
    │   id: "42"           │          │ permission_request   │
    │   result: {...}      │          │   request_id: "..."  │
    ├──────────────────────┤          │   tool_name: "..."   │
    │ notification         │          ├──────────────────────┤
    │   method: "..."      │          │ shutdown             │
    │   params: {...}      │          │   (no payload)       │
    ├──────────────────────┤          └──────────────────────┘
    │ log                  │
    │   message: "..."     │
    └──────────────────────┘
```

Only 4 message types in each direction. Simple and explicit.

## The McpProxy Trick

The worker doesn't have a real MCP server — the supervisor owns that. But the worker's code (discord.ts, permissions.ts, plugins) was written to call `ctx.mcp.notification()`.

The `McpProxy` class solves this by **duck-typing** the MCP Server interface:

```
Worker code:                           What actually happens:
─────────────                          ──────────────────────
ctx.mcp.notification({                 process.send({
  method: "notifications/message",       type: "notification",
  params: { text: "hello" }              method: "notifications/message",
})                                       params: { text: "hello" }
                                       })
                                       → IPC → Supervisor → real MCP → Claude
```

Existing code doesn't need to know it's in a child process. It just calls `ctx.mcp` like before.

## File Layout

| File | Role |
|---|---|
| `server.ts` | Thin wrapper: `import "./supervisor.ts"` |
| `supervisor.ts` | Immortal process: MCP, IPC, restart, PID |
| `worker.ts` | Disposable process: Discord, plugins, tools |
| `lib/ipc-types.ts` | Shared IPC message types |
| `lib/mcp-proxy.ts` | Duck-type MCP Server for worker (`notification()` + `setNotificationHandler()`) |
| `lib/mcp-server.ts` | `buildInstructions()` + `createMcpServer()` (used by worker + boot test) |

## PID File Guard

Only one supervisor can run at a time:

1. Check `~/.claude/plugins/data/choomfie-inline/choomfie.pid`
2. If PID exists → check if it's actually a choomfie process (via `ps`)
3. If yes → SIGTERM it, wait 500ms
4. Write own PID to file
5. On shutdown → delete PID file

## Key Design Decisions

### IPC: Bun built-in
`Bun.spawn({ ipc })` — zero setup, JSON built-in. Worker must be child process (fine for now). Swap to unix socket later if multi-brain needs many-to-many.

### Memory: shared SQLite (WAL mode)
SQLite file in data directory. Worker opens it for tool calls. Supervisor can open it later for compaction. WAL checkpoint on close prevents lock contention during restart.

### MCP Proxy pattern
Worker assigns `McpProxy` to `ctx.mcp`. It duck-types the MCP Server interface — `notification()` forwards via IPC, `setNotificationHandler()` stores handlers for permission relay. This means `discord.ts`, `permissions.ts`, and all plugins work **unchanged**.

### Supervisor-owned tools
Supervisor handles `restart` directly — never proxied to worker. Future: `compact` and `status` tools.

### Worker ready signal
Worker sends `ready` only after Discord login + `ClientReady` handler completes (plugins initialized, reminders loaded, slash commands deployed). 15s timeout on Discord ready to prevent indefinite hang.

### Crash recovery
Supervisor detects non-zero worker exit → auto-respawns with exponential backoff (1s, 2s, 4s, 8s, 15s cap). Gives up after 5 crashes within 60s to prevent infinite crash loops. Manual restart via tool resets the crash counter. Intentional restarts suppress auto-respawn to prevent race conditions (old worker exit handler spawning a duplicate).

### Startup ordering
Supervisor waits for worker `ready` before creating the MCP server. This ensures the `initialize` handshake serves real instructions (persona, security rules, plugin instructions) instead of stale fallback text. If the worker times out (30s), MCP connects with fallback instructions — the worker may still come up later and trigger `tools/list_changed`.

### Tool list synchronization
When the worker sends `ready` (initial or after restart), supervisor sends a `notifications/tools/list_changed` notification to Claude Code, which re-fetches the tool list. Also patches `_instructions` on the MCP Server instance for any future re-initialization.

## Error Handling

- All `worker.send()` calls in supervisor wrapped in try-catch
- All `process.send()` calls in worker use optional chaining + try-catch
- Tool calls have 2min timeout — rejected if worker dies or hangs
- Pending tool calls rejected on worker exit (with proper cleanup of old-worker-only state)
- MCP proxy guards against missing IPC channel (worker run outside supervisor)
- Restart tool returns success-with-warning on timeout instead of throwing (worker may still come up)

## Timeouts

| What | Duration |
|---|---|
| Worker ready | 30s |
| Discord ready (in worker) | 15s |
| Tool call | 2min |
| Graceful shutdown wait | 5s |

## Summary

| Concept | What | Why |
|---------|------|-----|
| **Supervisor** | Immortal process, owns MCP stdio | Claude Code connection survives restarts |
| **Worker** | Disposable process, owns Discord + tools | Can be killed/restarted freely |
| **IPC** | Bun's built-in `process.send` | Fast, typed JSON, no sockets |
| **McpProxy** | Fake MCP server in worker | Existing code works unchanged |
| **PID guard** | Single-instance lock file | No duplicate bots |
| **Crash recovery** | Auto-respawn with backoff | Self-healing (up to 5 crashes/min) |
| **Restart tool** | Supervisor-owned, kills+respawns worker | Hot reload without dropping MCP |

---

## Phase 2: Worker-Requested Restart (Auto-Restart)

The worker currently has no way to ask the supervisor to restart it. Several operations update config but tell users "restart for full effect" — this phase adds a `request_restart` IPC message so the worker can trigger its own restart.

### IPC Addition

```
Worker → Supervisor:
  { type: "request_restart", reason: "persona switch: takagi", chat_id?: "123..." }

Supervisor → Worker (after restart completes):
  { type: "restart_confirmation", reason: "persona switch: takagi", chat_id: "123..." }
```

The optional `chat_id` enables restart confirmation: after the new worker boots, the supervisor tells it to send a "✓ Restarted" message to the channel. This is used by slash commands (which bypass Claude). MCP tool restarts don't need it — Claude sees the tool result and handles follow-up itself.

Supervisor handles it identically to the `restart` tool — graceful shutdown, respawn, wait for ready, send `tools/list_changed`.

### Auto-Restart Triggers

| Trigger | Where | Current Behavior | After |
|---------|-------|-----------------|-------|
| **Persona switch** (MCP tool) | `lib/tools/persona-tools.ts` | Updates config, returns "restart for full effect" | Auto-restarts, new persona loads in system prompt |
| **Persona switch** (slash command) | `lib/commands.ts` `/persona switch` | Updates config, says "restart for full effect" | Auto-restarts |
| **Plugin enable/disable** (slash command) | `lib/commands.ts` `/plugins` | Updates config, says "restart to activate/deactivate" | Auto-restarts, plugin loads/unloads |
| **Voice config change** (setup wizard buttons) | `lib/commands.ts` voice-setup handler | Updates config, says "restart to apply changes" | Auto-restarts, new STT/TTS providers initialize |
| **Code update / hot reload** | N/A (manual restart today) | Owner calls `restart` tool manually | Could auto-detect file changes (future — watchmode) |

### Implementation

1. **`lib/ipc-types.ts`** — Add `IpcRequestRestart` type:
   ```typescript
   export interface IpcRequestRestart {
     type: "request_restart";
     reason: string;
   }
   ```
   Add to `WorkerMessage` union.

2. **`lib/mcp-proxy.ts`** or **`lib/types.ts`** — Expose restart request on AppContext:
   ```typescript
   // Option A: method on McpProxy
   ctx.mcp.requestRestart("persona switch: takagi")

   // Option B: method on AppContext directly
   ctx.requestRestart("persona switch: takagi")
   ```
   Both just call `process.send({ type: "request_restart", reason })`.

3. **`supervisor.ts`** — Handle `request_restart` in the worker message handler:
   - Extract the restart logic from `handleSupervisorTool("restart")` into a shared `restartWorker(reason)` function
   - Call it from both the `restart` tool handler and the `request_restart` IPC handler
   - Note: the tool_call that triggered the persona switch is still pending — need to either:
     - (a) Return the tool result first, then restart (small delay)
     - (b) Let the restart kill the worker, supervisor resolves pending tool call with "restarting..."

4. **`lib/tools/persona-tools.ts`** — After `switchPersona()`, call `ctx.requestRestart()`:
   ```typescript
   handler: async (args, ctx) => {
     const persona = ctx.config.switchPersona(args.key as string);
     if (!persona) return err(...);
     ctx.requestRestart(`persona switch: ${args.key}`);
     return text(`Switched to **${persona.name}**. Restarting...`);
   },
   ```

5. **`lib/commands.ts`** — Same pattern for `/persona switch`, `/plugins enable|disable`, voice-setup buttons:
   ```typescript
   ctx.requestRestart(`plugin ${action}: ${name}`);
   ```

### Timing Consideration

The tricky part: when a tool triggers restart, the tool result needs to reach Claude Code before the worker dies. Flow:

```
Worker: switchPersona() → send tool_result via IPC → send request_restart via IPC
Supervisor: receives tool_result → forwards to Claude via MCP → receives request_restart → begins restart
```

Since IPC messages are ordered (same channel), the tool result will always arrive at the supervisor before the restart request. The supervisor should forward the tool result to Claude, **then** begin the restart sequence. Small `setTimeout(0)` or `queueMicrotask()` may be needed to ensure the MCP response flushes before killing the worker.

### What This Replaces

After implementation, remove all "restart for full effect" / "restart to apply" messages from:
- `lib/tools/persona-tools.ts` (switch_persona)
- `lib/tools/discord-tools.ts` (reply tool description mentioning persona restart)
- `lib/commands.ts` (/persona switch, /plugins enable/disable, voice-setup buttons)
- `lib/tools/status-tools.ts` (status display mentioning restart)

## Future Phases

### Phase 3: Voice Auto-Rejoin
- Supervisor tracks active voice channels (join_voice / leave_voice via IPC)
- On worker respawn, send saved voice state → worker auto-joins

### Phase 4: Restart Handoff (basic compaction)
- Supervisor tracks last 10 messages (user full, bot truncated to ~500 chars)
- On restart: save handoff to memory/file
- On new session: inject handoff as context

### Phase 5: Idle Compaction (LLM-powered)
- Track message count since last compaction
- On idle (5 min + 50+ messages): ask Claude to triage via MCP notification
- 3 buckets: store to memory / compact to summary / toss

### Phase 6: Graceful Shutdown with Compaction
- Supervisor detects stdin close → sends compact request → timeout (10s) → skip if slow
- Cancel on new session (PID guard kills old supervisor)

### Phase 7: Multi-Bot (choomfie-sim)
- Supervisor manages worker pool (one per bot/persona)
- Each worker = different Discord token
- Claude sees messages from all bots, tagged with source

### Phase 8: Multi-Brain
- One bot, multiple Claude connections
- Route by channel, topic, or load
