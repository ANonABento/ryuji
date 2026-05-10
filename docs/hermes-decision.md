# Hermes Integration Spike

Status: experimental branch (`research/hermes-brain-spike`)

## Recommendation

Keep Choomfie as the Discord-native shell and treat Hermes as an optional peer brain, not a replacement or fork target yet.

The useful shape is:

1. Choomfie owns Discord, plugin lifecycle, voice routing, tutor lessons, permissions, and local bot UX.
2. Hermes can own an agent loop behind an OpenAI-compatible API endpoint.
3. Choomfie can route selected local-mode chat or background work to Hermes through a `ChatProvider`.
4. We borrow Hermes architecture ideas where they fit Choomfie directly: skills, procedural memory, busy-input modes, subagents, cron, and durable task orchestration.

## Why Not Swap

Hermes overlaps heavily with Choomfie: gateway messaging, memory, skills, voice, tools, scheduling, and agent runtime. A full swap would mean re-porting Choomfie's Discord affordances, tutor modules, voice behavior, permissions, and Claude Code plugin compatibility into a Python agent platform.

That is too much coupling for a first move.

## Why Not Fork

Forking Hermes is only attractive if Hermes becomes the primary runtime. Right now, the safer bet is an integration boundary:

- Choomfie can keep moving independently.
- Hermes can be updated independently.
- The experiment can be disabled by config.
- We can compare behavior using the same Discord shell.

Fork only if the peer-brain experiment proves Hermes should own most agent behavior.

## Current Experiment

This branch adds an opt-in Hermes provider behind Choomfie's existing local runtime.

Config sketch:

```json
{
  "local": {
    "enabled": true,
    "brainProvider": "hermes",
    "hermesUrl": "http://127.0.0.1:8642/v1",
    "hermesModel": "hermes-agent",
    "backgroundTasks": {
      "enabled": false
    }
  }
}
```

Environment:

```bash
export HERMES_API_SERVER_KEY=...
```

Hermes requires `API_SERVER_KEY` authentication before it will accept caller-supplied `X-Hermes-Session-Id` or `X-Hermes-Session-Key` headers. If the key is omitted, Choomfie can still call Hermes statelessly, but the peer-brain memory/session test is disabled.

## What This Tests

- Can Choomfie use Hermes as a local-mode reply backend without taking over Discord?
- Does an OpenAI-compatible `ChatProvider` seam cover Hermes cleanly?
- Can `/local status`, model registry, benchmark, and background worker code remain mostly unchanged?
- Does Hermes' agent loop produce responses we like more than a direct Ollama chat model?
- Does mapping Discord channels to `X-Hermes-Session-Id` and Discord users to `X-Hermes-Session-Key` give useful continuity without handing Hermes the Discord gateway?

## What It Does Not Test Yet

- Hermes-native skills called from Choomfie tools.
- Hermes memory sharing with Choomfie's SQLite memory.
- Hermes subagents mapped to Choomfie/Bento-ya task orchestration.
- Voice transcripts routed through Hermes.
- Discord gateway ownership by Hermes.

## Evaluation Rubric

Prefer "peer brain" if Hermes gives better:

- Long-horizon task planning.
- Self-improving skills.
- Memory use.
- Multi-step background work.
- API stability.

Prefer "inspiration only" if:

- API setup is brittle.
- Responses are not meaningfully better than current local mode.
- Hermes memory/skills are hard to make deterministic.
- Operational complexity feels heavier than the benefit.

Prefer "fork/swap" only if:

- Hermes clearly outperforms Choomfie as a complete runtime.
- Discord/voice/tutor migration looks smaller than maintaining both.
- We are comfortable following Hermes' release cadence and Python stack.

## Current Lean

Peer brain plus borrowed design patterns.

Choomfie stays the personal runtime. Hermes becomes an optional specialist brain.
