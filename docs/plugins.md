# Plugin System

Choomfie uses a plugin architecture — the core handles Discord bridging, memory, personas, and basic tools. Everything else (voice, language learning, image gen, etc.) is a plugin.

> Last updated: 2026-04-02

---

## Quick Start

### Enable a plugin

1. Make sure the plugin exists as a workspace package in `plugins/<name>/`
2. Add it to `config.json`:
   ```json
   {
     "plugins": ["voice"]
   }
   ```
3. Restart the bot

### Disable a plugin

Remove it from the `plugins` array in `config.json` and restart.

---

## How Plugins Work

### Lifecycle

```
Startup:
  createContext()              → loads env, config, memory
  loadPlugins(config)          → reads plugins array, imports each plugin
  createMcpServer(ctx)         → registers core + plugin tools, builds instructions
  createDiscordClient(ctx)     → merges plugin intents into Discord client
  discord.login()              → connects to Discord
  ClientReady event            → calls plugin.init(ctx) for each plugin

Runtime:
  MessageCreate event          → calls plugin.onMessage(msg, ctx) for each plugin
  Tool calls from Claude       → plugin tools handled via same Map lookup as core tools

Shutdown:
  SIGINT                       → calls plugin.destroy() for each plugin
```

### Plugin Interface

Every plugin exports a default object implementing the `Plugin` interface from `@choomfie/shared`:

```typescript
import type { Plugin } from "@choomfie/shared";

const myPlugin: Plugin = {
  // Required
  name: "my-plugin",

  // Optional — MCP tools (same ToolDef pattern as core tools)
  tools: [
    {
      definition: { name: "my_tool", description: "...", inputSchema: {...} },
      handler: async (args, ctx) => { /* ... */ },
    },
  ],

  // Optional — appended to MCP system prompt
  instructions: [
    "## My Plugin",
    "Use my_tool to do X.",
  ],

  // Optional — extra Discord gateway intents
  intents: [GatewayIntentBits.GuildVoiceStates],

  // Optional — tool names non-owner users can call
  userTools: ["my_tool"],

  // Optional — runs once after Discord is connected
  async init(ctx) { /* setup code */ },

  // Optional — runs on every Discord message (before default handler)
  async onMessage(message, ctx) { /* message hook */ },

  // Optional — cleanup on shutdown
  async destroy() { /* teardown */ },
};

export default myPlugin;
```

### Plugin Interface Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `name` | `string` | Yes | Unique identifier (e.g. `"voice"`) |
| `tools` | `ToolDef[]` | No | MCP tools — auto-registered, callable by Claude |
| `instructions` | `string[]` | No | Lines appended to the MCP system prompt |
| `intents` | `GatewayIntentBits[]` | No | Extra Discord intents merged into client |
| `userTools` | `string[]` | No | Plugin tools that non-owner users can call |
| `init` | `(ctx) => Promise<void>` | No | Called once after Discord ready |
| `onMessage` | `(msg, ctx) => Promise<void>` | No | Hook into every message |
| `destroy` | `() => Promise<void>` | No | Cleanup on shutdown |

---

## Creating a New Plugin

### 1. Create the workspace package

```
plugins/
  my-plugin/
    package.json   # { "name": "@choomfie/my-plugin", "dependencies": { "@choomfie/shared": "workspace:*" } }
    index.ts       # Plugin entry — exports default Plugin
```

### 2. Write the plugin

```typescript
// plugins/my-plugin/index.ts
import type { Plugin, ToolDef } from "@choomfie/shared";
import { text, err } from "@choomfie/shared";

const tools: ToolDef[] = [
  {
    definition: {
      name: "hello_world",
      description: "Says hello",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Who to greet" },
        },
        required: ["name"],
      },
    },
    handler: async (args, ctx) => {
      return text(`Hello, ${args.name}!`);
    },
  },
];

const plugin: Plugin = {
  name: "my-plugin",
  tools,
  instructions: ["## My Plugin", "Use hello_world to greet someone."],
};

export default plugin;
```

### 3. Enable it

Add `"my-plugin"` to the `plugins` array in `config.json`:

```json
{
  "plugins": ["my-plugin"]
}
```

### 4. Register in the plugin loader

Add the package to the workspace map in `packages/core/lib/plugins.ts`, then restart.

---

## Plugin State

Plugins manage their own state via module scope. The `AppContext` is passed to tools and hooks but plugins should NOT add fields to it.

```typescript
// Plugin-local state (module scope)
const connections = new Map<string, MyConnection>();

const plugin: Plugin = {
  name: "my-plugin",
  tools: [
    {
      definition: { /* ... */ },
      handler: async (args, ctx) => {
        // Close over module-scoped state
        const conn = connections.get(args.id as string);
        // ...
      },
    },
  ],
};
```

---

## Dependencies

Plugins are workspace packages. Add dependencies to the plugin's own `package.json`:

```bash
cd plugins/my-plugin
bun add some-package
```

Or add to the root `package.json` if shared across packages. All packages share the same `node_modules` via Bun workspaces.

---

## Error Handling

Plugin errors are caught and logged — a failing plugin won't crash the bot:
- `init()` errors → logged to stderr, plugin skipped
- `onMessage()` errors → logged, message processing continues
- `destroy()` errors → logged, shutdown continues
- Tool handler errors → returned as MCP error response

---

## File Structure

```
plugins/
  <name>/
    package.json       # Workspace package with @choomfie/shared dependency
    index.ts           # Required — exports default Plugin
    tools.ts           # Optional — ToolDef[] (for organization)
    *.ts               # Optional — internal modules
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/types.ts` | `Plugin` interface definition |
| `packages/core/lib/plugins.ts` | Plugin loader (explicit workspace package map) |
| `packages/core/lib/tools/index.ts` | Merges plugin tools into core tool registry |
| `packages/core/lib/mcp-server.ts` | Appends plugin instructions to system prompt |
| `packages/core/lib/discord.ts` | Merges intents, calls init/onMessage hooks |
| `packages/core/lib/config.ts` | `plugins` array + plugin-specific config sections |
