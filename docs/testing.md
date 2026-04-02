# Testing Strategy

## Current State (v0.4.x)

Tests live in `packages/core/test/`. Smoke test (`boot.test.ts`) verifies server construction, `plugins.test.ts` validates plugin loading, `srs.test.ts` tests spaced repetition. Codebase is still evolving too fast for a full test suite to be worth maintaining.

## Plan for v0.5+

### E2E Tests (Priority 1)

Full integration tests that spawn the actual server and verify real behavior. These catch the bugs that matter — like the zombie process issue where `discord.destroy()` was never called.

**Test runner:** `bun:test`

**Approach:** Spawn `bun packages/core/server.ts` as a subprocess with a mock Discord gateway (or test bot token in a dedicated test server). Verify:

- Server starts, PID file created
- Discord client connects and bot goes online
- Stdin close → process exits, PID file removed, bot goes offline
- SIGTERM → same clean shutdown
- New server instance kills stale process via PID file
- MCP tools respond correctly over stdio
- Messages from Discord → MCP notifications flow through
- Reminders fire at correct times
- Memory CRUD operations persist to SQLite
- Rate limiting blocks rapid messages
- Conversation mode activates/deactivates on timeout
- Plugin lifecycle (load → init → destroy)

**Test Discord setup:**
- Dedicated test server with a test bot token
- Token stored in `.env.test` (gitignored)
- Tests create/clean up their own channels

### Unit Tests (Priority 2)

For stable, logic-heavy modules where mocking is minimal:

| Module | What to test |
|--------|-------------|
| `packages/core/lib/reminders.ts` | Timer scheduling, cron parsing, nag intervals, snooze |
| `packages/core/lib/memory.ts` | CRUD, search ranking, archival, stats |
| `packages/core/lib/conversation.ts` | Rate limiting, channel activation, timeout |
| `packages/shared/time.ts` | SQLite datetime formatting, timezone handling |
| `packages/core/lib/config.ts` | Persona CRUD, setting updates, file persistence |
| `packages/core/lib/permissions.ts` | Pairing code generation, reply parsing |

### Plugin Tests (Priority 3)

Each plugin gets its own test file in `packages/<name>/test/`:

```
packages/
  voice/
    test/
      manager.test.ts     # join/leave/speak flow
      providers.test.ts   # STT/TTS provider interface
  tutor/
    test/
      quiz.test.ts        # quiz generation, scoring
      dictionary.test.ts  # Jisho API responses
      session.test.ts     # per-user state management
  socials/
    test/
      providers.test.ts   # URL detection, embed generation
```

## CI Pipeline (v1.0)

### PR Checks

```
on: pull_request
jobs:
  test:
    - bun install
    - bun test                    # unit + e2e
    - bun run type-check          # tsc --noEmit
  lint:
    - bunx biome check .          # or eslint
```

### Merge Requirements

- All tests pass
- No type errors
- Lint clean

### Test Categories

Use bun:test's `describe` blocks or file naming to separate:

```bash
bun test                              # everything
bun test packages/core/test/          # core tests
bun test packages/*/test/             # all package tests
```

## Conventions

- Test files live in `packages/<name>/test/` directories
- Use real SQLite (in-memory `:memory:` for unit tests, temp file for e2e)
- No mocking Discord API calls — use a real test bot in a test server for e2e, skip Discord for unit tests
- Tests must clean up after themselves (temp files, DB state)
- Each test file should be runnable in isolation

## Not Planning To Test

- Discord.js internals (trust the library)
- MCP SDK transport (trust the SDK)
- Bun runtime behavior (trust the runtime)
- Visual/formatting output (too brittle, verify manually)
