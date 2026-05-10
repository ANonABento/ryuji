# Legacy Bun Runtime

This is the previous Choomfie implementation:

```text
Claude Code
  -> Choomfie MCP server
  -> Bun supervisor/worker
  -> Discord/plugins/tools
```

It has been moved here so the repository root can focus on:

```text
Hermes upstream
  + hermes-overlay/
  = Choomfie
```

## Run

From the repository root:

```bash
choomfie legacy
```

or:

```bash
bun run legacy:start
bun run legacy:start:local
bun run daemon
```

## Layout

```text
legacy/bun/
  packages/
    core/
    shared/
  plugins/
    browser/
    socials/
    tutor/
    voice/
```

