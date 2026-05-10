# Choomfie / Hermes Runtime Comparison

This is the first comparison pass for the three migration shapes:

1. current Bun Choomfie
2. current Choomfie shell plus Hermes brain
3. direct Hermes overlay

## Evidence Gathered

| Check | Result |
| --- | --- |
| Current Choomfie code inventory | Legacy runtime owns Discord, permissions, plugins, tutor, voice, reminders, memory tools, and local mode under `legacy/bun/packages/core/` and `legacy/bun/plugins/`. |
| Choomfie shell plus Hermes brain | Existing spike docs describe an OpenAI-compatible Hermes `ChatProvider` path in `docs/hermes-decision.md`. This still needs a live Choomfie local-mode run with Hermes credentials. |
| Direct Hermes overlay | Verified locally with `hermes-overlay/scripts/run-choomfie.sh` using a temp `CHOOMFIE_HERMES_HOME`, `API_SERVER_ENABLED=true`, and `API_SERVER_PORT=18642`. |
| Hermes API server | `GET /v1/models` with `Authorization: Bearer choomfie-dev-key` returned model id `choomfie`. |
| Global state isolation | Live run used a temp Hermes home and the local checkout wrapper. No global Hermes profile was required. |

## Comparison Matrix

| Mode | Best For Now | Strengths | Weak Spots |
| --- | --- | --- | --- |
| Current Bun Choomfie | Production Discord/voice/tutor behavior | Known Discord UX, existing plugin lifecycle, current tutor modules, current voice path. | More custom runtime to maintain; less leverage from Hermes subagents/cron/skills. |
| Choomfie shell plus Hermes brain | Transition and A/B tests | Keeps Discord and voice stable while Hermes handles agent loop/model routing. | Requires careful session mapping and memory policy between systems. |
| Direct Hermes overlay | Long-term distro target | Small Choomfie layer over upstream Hermes, native gateway/API, native skills/memory/cron/subagents. | Needs Choomfie-specific Discord UX, tutor depth, voice behavior, and memory conventions ported. |

## Current Recommendation

Use direct Hermes overlay as the main path:

- run Choomfie through `bin/choomfie`
- keep Bun Choomfie only as `bin/choomfie-legacy`
- port tutor as a Hermes skill-first slice
- avoid moving voice until tutor and memory behavior are proven

Direct Hermes overlay is runnable enough for API-level testing. The remaining gap is feature parity with the legacy Discord bot, not the runtime foundation.
