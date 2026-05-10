# Choomfie Hermes Overlay

Choomfie is becoming a curated personal agent distribution layered on top of Hermes.

The intended shape is:

```text
Hermes upstream
  + Choomfie overlay
  + Choomfie skills/plugins
  + Choomfie personality, memory, tutor, voice, and bento defaults
  = Choomfie
```

This directory should stay outside Hermes core. Prefer profile files, config, skills, plugins, toolsets, and local launch scripts over patches. If Hermes needs a hook that does not exist, try an upstream contribution before carrying a fork patch.

The overlay is also a Hermes profile distribution: `distribution.yaml`, `SOUL.md`, `config.yaml`, `.env.EXAMPLE`, `skills/`, `plugins/`, and `toolsets/` are intentionally at the root so Hermes can install it through `hermes profile install`.

## Layout

```text
hermes-overlay/
  distribution.yaml
  SOUL.md
  config.yaml
  .env.EXAMPLE
  profiles/
    choomfie.yaml
    SOUL.md
  skills/
    tutor/
  plugins/
  toolsets/
    choomfie-safe.yaml
    choomfie-dev.yaml
  config/
    hermes.env.example
    config.yaml.example
  scripts/
    install-hermes.sh
    run-choomfie.sh
    update-hermes.sh
    doctor.sh
```

## Operating Rules

- Do not hard fork Hermes unless a vertical slice proves there is no clean overlay path.
- Pin Hermes versions in local setup.
- Keep Choomfie-specific code outside Hermes core.
- Prefer skills, plugins, and config over patches.
- Keep the current Bun Choomfie working until replacement slices are proven.
- Port vertical slices, not the whole runtime at once.

## Quick Start

1. Copy the example environment file:

   ```bash
   cp hermes-overlay/config/hermes.env.example .env.hermes
   ```

2. Edit `.env.hermes` with the Hermes binary path, model provider settings, and API key.
3. Start Choomfie-Hermes:

   ```bash
   hermes-overlay/scripts/run-choomfie.sh
   ```

The runner uses a Choomfie-specific Hermes home by default and avoids modifying global Hermes state.

If the global `hermes` command is not installed, run:

```bash
hermes-overlay/scripts/install-hermes.sh --local
```

The overlay can then launch the local checkout through `hermes-overlay/scripts/hermes-local.sh`.
