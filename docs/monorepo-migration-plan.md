# Monorepo Migration Plan

> Detailed plan for restructuring Choomfie from a flat project into a monorepo with independently usable packages.

## Goal

Each plugin becomes a package that can:
1. Run inside Choomfie (current behavior, via plugin system)
2. Run as a standalone MCP server (no Discord, no Choomfie core)
3. Be extracted to its own repo later if needed

## Current Structure

```
choomfie/
  server.ts, supervisor.ts, worker.ts, meta.ts
  lib/                  # Core modules (20 files)
    types.ts            # Plugin, ToolDef, AppContext, text(), err()
    config.ts           # ConfigManager
    time.ts             # nowUTC, toSQLiteDatetime, parseNaturalTime
    interactions.ts     # registerCommand, registerButtonHandler, registerModalHandler
    version.ts          # VERSION constant
    memory.ts, reminders.ts, discord.ts, context.ts, ...
    tools/              # Core MCP tools (9 files)
    handlers/           # Discord interaction handlers (4 files)
  plugins/
    voice/              # 20 files, 2053 LOC
    browser/            # 3 files, 515 LOC
    tutor/              # 23 files, 3092 LOC
    socials/            # 13 files, 4420 LOC
  test/                 # 3 test files
  scripts/, skills/, docs/, bin/
```

## Target Structure

```
choomfie/
  package.json                    # Root: bun workspaces, scripts, dev deps
  packages/
    shared/                       # @choomfie/shared — types + utils
      package.json
      index.ts                    # Re-exports everything
      types.ts                    # Plugin, ToolDef, ToolResult, text(), err()
      plugin-context.ts           # PluginContext (minimal subset of AppContext)
      time.ts                     # nowUTC, toSQLiteDatetime, dateToSQLite, parseNaturalTime
      interactions.ts             # registerCommand, registerButtonHandler, registerModalHandler
      version.ts                  # VERSION
    core/                         # @choomfie/core — Discord bridge, memory, etc.
      package.json
      server.ts, supervisor.ts, worker.ts, meta.ts
      lib/
        types.ts                  # AppContext (extends PluginContext), re-exports shared
        config.ts, memory.ts, reminders.ts, discord.ts, context.ts, ...
        plugins.ts                # Plugin loader (updated for packages)
        tools/, handlers/
      test/
      scripts/, skills/, bin/
    voice/                        # @choomfie/voice
      package.json
      index.ts                    # Plugin export (for Choomfie)
      standalone.ts               # Standalone MCP server entry
      manager.ts, tools.ts, vad.ts, ...
      providers/
    browser/                      # @choomfie/browser
      package.json
      index.ts                    # Plugin export
      standalone.ts               # Standalone MCP server entry
      session.ts, tools.ts
    tutor/                        # @choomfie/tutor
      package.json
      index.ts                    # Plugin export
      standalone.ts               # Standalone MCP server entry
      core/, tools/, modules/, lessons/
    socials/                      # @choomfie/socials
      package.json
      index.ts                    # Plugin export
      standalone.ts               # Standalone MCP server entry
      tools.ts, providers/
  docs/
  .claude-plugin/
  .mcp.json
  CLAUDE.md, README.md, LICENSE
```

## Key Design Decisions

### 1. PluginContext vs AppContext

**Problem:** Plugins currently receive `AppContext` which contains everything (discord client, memory store, reminder scheduler, etc). Most plugins only use a few fields. Plugins shouldn't depend on core's full context.

**Solution:** Create a minimal `PluginContext` in `@choomfie/shared`:

```typescript
// packages/shared/plugin-context.ts
export interface PluginContext {
  /** Data directory for persistent storage */
  DATA_DIR: string;
  /** Config manager (read settings, OAuth creds, etc.) */
  config: {
    getConfig(): Record<string, any>;
    getVoiceConfig?(): { stt: string; tts: string; ttsSpeed?: number };
  };
  /** MCP server or proxy for sending notifications */
  mcp?: {
    sendNotification?(notification: { method: string; params: any }): void;
  };
  /** Discord client (only if running inside Choomfie) */
  discord?: any;
  /** Owner user ID (for permission checks) */
  ownerUserId?: string | null;
}
```

Plugins code against `PluginContext`. When running inside Choomfie, they receive the full `AppContext` (which extends `PluginContext`). When running standalone, they receive a minimal implementation.

**Impact on plugins:** Change `AppContext` → `PluginContext` in tool handler signatures. `ToolDef.handler` takes `PluginContext` instead of `AppContext`.

### 2. Interaction System (Tutor's slash commands)

**Problem:** Tutor plugin imports `registerCommand` and `registerButtonHandler` from `lib/interactions.ts` via side-effect imports. This is the tightest coupling point.

**Solution:** Move the handler registries to `@choomfie/shared/interactions.ts`. The registries are just `Map<string, handler>` — they have no core dependencies. Core's `lib/interactions.ts` re-imports from shared and adds the dispatch logic.

**Alternative:** Plugins export their interaction handlers as part of the Plugin interface instead of using side-effect registration. This is a cleaner pattern:

```typescript
// In Plugin interface (shared/types.ts)
export interface Plugin {
  // ... existing fields
  commands?: CommandDef[];        // Slash commands this plugin registers
  buttonHandlers?: Map<string, ButtonHandler>;
  modalHandlers?: Map<string, ModalHandler>;
}
```

**Recommendation:** Use the Plugin interface approach. It's more explicit, avoids global mutable state, and works in standalone mode too. This means refactoring tutor's `lesson-interactions.ts` to export handlers instead of registering them via side effect.

### 3. Standalone MCP Server Entry

Each plugin package gets a `standalone.ts` that creates a minimal MCP server:

```typescript
// packages/tutor/standalone.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import tutorPlugin from "./index.ts";

const server = new Server({ name: "choomfie-tutor", version: "0.4.0" }, { capabilities: { tools: {} } });

// Register tools
for (const tool of tutorPlugin.tools ?? []) {
  server.setRequestHandler("tools/call", async (req) => { ... });
}

// Create minimal PluginContext
const ctx: PluginContext = {
  DATA_DIR: process.env.DATA_DIR || "~/.choomfie-tutor",
  config: { getConfig: () => ({}) },
};

await tutorPlugin.init?.(ctx);
const transport = new StdioServerTransport();
await server.connect(transport);
```

This means each plugin can be used as:
- `claude --plugin-dir ./packages/tutor` (standalone Claude Code plugin)
- `bun packages/tutor/standalone.ts` (raw MCP server)
- Loaded by Choomfie core via the plugin system (current behavior)

### 4. Package Dependencies

```
@choomfie/shared     ← no deps on other packages
@choomfie/core       ← depends on @choomfie/shared
@choomfie/voice      ← depends on @choomfie/shared
@choomfie/browser    ← depends on @choomfie/shared
@choomfie/tutor      ← depends on @choomfie/shared
@choomfie/socials    ← depends on @choomfie/shared
```

No plugin depends on core. No plugin depends on another plugin. Clean DAG.

### 5. npm Dependency Splitting

Currently all deps are in root `package.json`. Each package should only declare its own deps:

| Package | Dependencies |
|---------|-------------|
| shared | (none — pure TypeScript) |
| core | discord.js, @modelcontextprotocol/sdk, @anthropic-ai/claude-agent-sdk |
| voice | @discordjs/opus, @discordjs/voice, @ricky0123/vad-node, onnxruntime-node, opusscript, prism-media, sodium-native |
| browser | playwright |
| tutor | ts-fsrs, wanakana, kuroshiro, @sglkc/kuroshiro-analyzer-kuromoji |
| socials | (none — uses raw fetch) |

## Migration Steps

### Pre-flight: Expand Test Coverage

Before touching any structure, add regression tests that verify current behavior. These tests will catch breakage during migration.

```
test/
  regression/
    tools-register.test.ts    # Verify all 42 tools register correctly
    plugin-load.test.ts       # Verify all 4 plugins load
    plugin-tools.test.ts      # Verify each plugin exports expected tool names
    imports.test.ts           # Verify no circular dependencies
    boot.test.ts              # Existing boot test (keep)
```

**Tests to write:**

1. **Tool registration test** — Load each plugin, verify tool count + names match expected:
   - voice: join_voice, leave_voice, speak (3)
   - browser: browse, browser_click, browser_type, browser_screenshot, browser_eval, browser_press_key, browser_close (7)
   - tutor: tutor_prompt, quiz, dictionary_lookup, set_level, convert_kana, list_modules, switch_module, srs_review, srs_rate, srs_stats, lesson_status (11)
   - socials: youtube_search, youtube_info, youtube_transcript, youtube_auth, youtube_comment, reddit_search, reddit_posts, reddit_comments, reddit_auth, reddit_post, reddit_comment, linkedin_auth, linkedin_post, linkedin_post_image, linkedin_post_images, linkedin_post_link, linkedin_edit, linkedin_poll, linkedin_repost, linkedin_delete, linkedin_comments, linkedin_comment, linkedin_react, linkedin_schedule, linkedin_queue, linkedin_monitor, linkedin_analytics, linkedin_status (28)

2. **Import validation test** — Verify no plugin imports from another plugin directory.

3. **Plugin interface test** — Each plugin's default export has `name`, `tools`, and expected fields.

Run all tests after each step. If any fail, fix before proceeding.

### Step 1: Create root workspace config

```json
// package.json (root)
{
  "name": "choomfie-monorepo",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "bun test",
    "test:all": "bun test packages/*/test/ test/"
  },
  "devDependencies": {
    "@types/bun": "^1.3.10"
  }
}
```

### Step 2: Create @choomfie/shared package

```bash
mkdir -p packages/shared
```

Extract from `lib/`:
- `types.ts` → `packages/shared/types.ts` (Plugin, ToolDef, ToolResult, text, err)
- New `packages/shared/plugin-context.ts` (PluginContext interface)
- `time.ts` → `packages/shared/time.ts` (time utilities — they have no core deps)
- `version.ts` → `packages/shared/version.ts`
- `interactions.ts` → `packages/shared/interactions.ts` (just the registries + register functions)

Create `packages/shared/index.ts` that re-exports everything.

Create `packages/shared/package.json`:
```json
{
  "name": "@choomfie/shared",
  "version": "0.4.0",
  "type": "module",
  "main": "index.ts",
  "license": "MIT"
}
```

**Critical:** `lib/types.ts` currently imports from `./memory.ts`, `./config.ts`, `./reminders.ts` for the `AppContext` interface. The shared package must NOT have these imports. Split:
- `PluginContext` (shared — no core deps)
- `AppContext extends PluginContext` (stays in core's `lib/types.ts`)

### Step 3: Move core to packages/core

```bash
mkdir -p packages/core
mv server.ts supervisor.ts worker.ts meta.ts packages/core/
mv lib/ packages/core/lib/
mv test/ packages/core/test/
mv scripts/ packages/core/scripts/
mv skills/ packages/core/skills/
mv bin/ packages/core/bin/
mv install.sh packages/core/
```

Update `packages/core/lib/types.ts` to import from `@choomfie/shared` and extend:
```typescript
import { PluginContext, Plugin, ToolDef, ToolResult, text, err } from "@choomfie/shared";
export { Plugin, ToolDef, ToolResult, text, err };

export interface AppContext extends PluginContext {
  discord: Client;
  memory: MemoryStore;
  // ... core-only fields
}
```

Update `packages/core/package.json` with core-specific deps.

### Step 4: Move plugins to packages

```bash
mv plugins/voice packages/voice
mv plugins/browser packages/browser
mv plugins/tutor packages/tutor
mv plugins/socials packages/socials
```

For each plugin:
1. Create `package.json` with plugin-specific deps
2. Update all `../../lib/types.ts` imports → `@choomfie/shared`
3. Update all `../../lib/time.ts` imports → `@choomfie/shared`
4. Update all `../../lib/interactions.ts` imports → `@choomfie/shared`
5. Update all `../../lib/version.ts` imports → `@choomfie/shared`
6. Replace `AppContext` with `PluginContext` in tool handlers

### Step 5: Update plugin loader

Update `packages/core/lib/plugins.ts` to load from workspace packages:

```typescript
// Option A: Explicit package imports
const PLUGIN_PACKAGES: Record<string, string> = {
  voice: "@choomfie/voice",
  browser: "@choomfie/browser",
  tutor: "@choomfie/tutor",
  socials: "@choomfie/socials",
};

for (const name of enabled) {
  const pkgName = PLUGIN_PACKAGES[name];
  if (!pkgName) { console.error(`Unknown plugin: ${name}`); continue; }
  const mod = await import(pkgName);
  const plugin: Plugin = mod.default;
  // ... same validation as before
}
```

```typescript
// Option B: Keep filesystem discovery but in packages/
const pluginsDir = join(projectRoot, "packages");
// Discover packages that export a Plugin interface
```

**Recommendation:** Option A. Explicit is better. Keeps the exact same config.json `plugins: ["voice", "socials"]` behavior.

### Step 6: Update MCP/plugin entry points

- `.mcp.json` — update `server.ts` path to `packages/core/server.ts`
- `.claude-plugin/plugin.json` — update entry point
- `bin/choomfie` — update `CHOOMFIE_DIR` to point at `packages/core`

### Step 7: Create standalone entries (optional, can defer)

For each plugin, create `packages/<name>/standalone.ts`:
- Minimal MCP server that loads the plugin's tools
- Creates a `PluginContext` from env vars
- Connects via stdio transport

This step is optional for the initial migration. Can be added later per-plugin as needed.

### Step 8: Run all tests, fix, commit

Run the full test suite. Fix any import path issues. The regression tests from pre-flight will catch any missing tools or broken interfaces.

## Exact Import Changes Per Plugin

### voice/ (5 changes)
| File | Old Import | New Import |
|------|-----------|------------|
| index.ts | `../../lib/types.ts` → Plugin | `@choomfie/shared` → Plugin |
| tools.ts | `../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| manager.ts | `../../lib/types.ts` → AppContext | `@choomfie/shared` → PluginContext |
| providers/index.ts | `../../../lib/config.ts` → ConfigManager | `@choomfie/shared` → PluginContext (refactor) |

### browser/ (3 changes)
| File | Old Import | New Import |
|------|-----------|------------|
| index.ts | `../../lib/types.ts` → Plugin | `@choomfie/shared` → Plugin |
| tools.ts | `../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |

### tutor/ (14 changes)
| File | Old Import | New Import |
|------|-----------|------------|
| index.ts | `../../lib/types.ts` → Plugin | `@choomfie/shared` → Plugin |
| core/types.ts | `../../../lib/types.ts` → ToolDef | `@choomfie/shared` → ToolDef |
| core/srs.ts | `../../../lib/time.ts` → nowUTC, toSQLiteDatetime | `@choomfie/shared` → nowUTC, toSQLiteDatetime |
| core/lesson-db.ts | `../../../lib/time.ts` → nowUTC | `@choomfie/shared` → nowUTC |
| lesson-interactions.ts | `../../lib/interactions.ts` → registerCommand, registerButtonHandler | `@choomfie/shared` → registerCommand, registerButtonHandler |
| tools/index.ts | `../../../lib/types.ts` → ToolDef | `@choomfie/shared` → ToolDef |
| tools/srs-tools.ts | `../../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| tools/lesson-tools.ts | `../../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| tools/module-tools.ts | `../../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| tools/tutor-tools.ts | `../../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| modules/japanese/tools.ts | `../../../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |

### socials/ (4 changes)
| File | Old Import | New Import |
|------|-----------|------------|
| index.ts | `../../lib/types.ts` → Plugin | `@choomfie/shared` → Plugin |
| tools.ts | `../../lib/types.ts` → ToolDef, text, err | `@choomfie/shared` → ToolDef, text, err |
| providers/reddit/api.ts | `../../../../lib/version.ts` → VERSION | `@choomfie/shared` → VERSION |

## Potential Issues & Regressions

### 1. Bun workspace resolution
**Risk:** Bun's workspace resolution may not resolve `@choomfie/shared` correctly if packages don't have proper `main` fields.
**Mitigation:** Test with `bun install` after creating workspace config. Ensure each package.json has `"main": "index.ts"`.

### 2. Side-effect imports in tutor
**Risk:** `lesson-interactions.ts` registers slash commands via import side effects. If the import order changes during migration, commands may not register.
**Mitigation:** Explicitly import `lesson-interactions.ts` in tutor's `index.ts` init. Don't rely on transitive side effects.

### 3. Relative path breakage in tests
**Risk:** Tests use `import.meta.dir + "/.."` for project root. After moving tests to `packages/core/test/`, paths break.
**Mitigation:** Update test paths. Add a helper that resolves project root from any depth.

### 4. .mcp.json and .claude-plugin paths
**Risk:** Claude Code expects specific paths for the plugin entry. If `server.ts` moves, the plugin won't load.
**Mitigation:** Update `.mcp.json` and `.claude-plugin/plugin.json` immediately. Test by starting Choomfie.

### 5. bin/choomfie path resolution
**Risk:** The launcher script derives paths from its own location. Moving it breaks the path.
**Mitigation:** Update `CHOOMFIE_DIR` logic in the script.

### 6. Plugin data directory
**Risk:** Plugins store data in `ctx.DATA_DIR` which is `~/.claude/plugins/data/choomfie-inline/`. This doesn't change. But if standalone mode uses a different DATA_DIR, DBs won't be shared.
**Mitigation:** Standalone mode should default to the same DATA_DIR, or accept it as an env var.

### 7. Interaction system migration
**Risk:** If we change from side-effect registration to Plugin interface for commands/buttons, the tutor's lesson system may break.
**Mitigation:** Do this as a separate sub-step. Keep side-effect approach first, migrate to Plugin interface later (can be a follow-up PR).

### 8. TypeScript path mapping
**Risk:** Without a tsconfig.json, Bun resolves `@choomfie/shared` via `node_modules` symlinks (created by bun workspace). If symlinks break, imports fail.
**Mitigation:** Run `bun install` to create symlinks. Verify with a simple import test.

## Rollback Plan

If migration goes wrong:
1. `git stash` or `git checkout .` to revert all changes
2. The original flat structure is fully functional
3. No data migrations — SQLite DBs are untouched
4. No config changes — config.json format is unchanged

## Success Criteria

After migration:
- [ ] `bun test` passes (all existing + new regression tests)
- [ ] `bun packages/core/server.ts` starts the bot (existing startup flow)
- [ ] `choomfie` command works (bin/choomfie launcher)
- [ ] All 4 plugins load correctly
- [ ] All 42 tools register
- [ ] Discord messages received and replied to
- [ ] Slash commands work (/status, /remind, /lesson, etc.)
- [ ] Voice join/leave works
- [ ] LinkedIn post works
- [ ] Each plugin can import only from `@choomfie/shared` (no `../../lib/` paths)
- [ ] No circular dependencies between packages

## Future: Extracting to Separate Repos

Once the monorepo is working, any package can be extracted:

```bash
# Example: extract tutor to its own repo
git filter-repo --subdirectory-filter packages/tutor
# Push to github.com/ANonABento/mcp-tutor
# Replace in monorepo with git submodule or npm dependency
```

The key is that `@choomfie/shared` is the ONLY cross-package dependency. If extracting a plugin, it just needs `@choomfie/shared` published to npm (or vendored).

## Timeline

| Step | Description | Est. Time | Blocking |
|------|-------------|-----------|----------|
| 0 | Write regression tests | 30 min | Must pass before proceeding |
| 1 | Create workspace config | 10 min | - |
| 2 | Create @choomfie/shared | 45 min | Unblocks steps 3-4 |
| 3 | Move core to packages/core | 30 min | - |
| 4 | Move plugins + update imports | 60 min | Depends on step 2 |
| 5 | Update plugin loader | 20 min | Depends on step 4 |
| 6 | Update entry points (.mcp.json, bin/) | 15 min | Depends on step 3 |
| 7 | Standalone entries (optional) | 30 min | Can defer |
| 8 | Test + fix + commit | 30 min | - |
| **Total** | | **~3-4 hours** | |

## Commit Strategy

One commit per step (allows easy bisection if something breaks):
1. `Add regression tests for monorepo migration`
2. `Create @choomfie/shared package with types and utils`
3. `Move core to packages/core`
4. `Move voice plugin to packages/voice`
5. `Move browser plugin to packages/browser`
6. `Move tutor plugin to packages/tutor`
7. `Move socials plugin to packages/socials`
8. `Update plugin loader for workspace packages`
9. `Update entry points and launcher script`
10. `Add standalone MCP entries for plugins` (optional)
