# Choomfie Hermes Migration Plan

Choomfie should become a curated Hermes distribution, not a large Hermes fork.

```text
Hermes upstream
  + Choomfie overlay
  + Choomfie skills/plugins
  + Choomfie personality, memory, tutor, voice, and bento defaults
  = Choomfie
```

## Principles

- Do not hard fork Hermes unless necessary.
- Pin the Hermes version used for local testing.
- Keep Choomfie code outside Hermes core.
- Prefer skills, plugins, config, and toolsets over patches.
- If a Hermes core hook is missing, try an upstream contribution before carrying a patch.
- Keep old Choomfie working until replacement features are proven.
- Port vertical slices instead of attempting a whole-runtime migration.

## Phase 1: Overlay Skeleton

Status: started.

Deliverables:

| Deliverable | Status | Notes |
| --- | --- | --- |
| `hermes-overlay/README.md` | done | Explains overlay purpose, rules, and layout. |
| `hermes-overlay/profiles/SOUL.md` | done | Choomfie personality/profile defaults. |
| `hermes-overlay/config/hermes.env.example` | done | Local env template with API/gateway defaults. |
| `hermes-overlay/config/config.yaml.example` | done | Example profile config for Hermes. |
| `hermes-overlay/scripts/run-choomfie.sh` | done | Uses Choomfie-specific Hermes home and enables API/gateway. |
| `docs/hermes-migration-plan.md` | done | This plan and parity matrix. |

Script requirements:

| Requirement | Implementation |
| --- | --- |
| Check whether Hermes is installed | `run-choomfie.sh`, `install-hermes.sh`, and `doctor.sh` check `HERMES_BIN`. |
| Point Hermes at Choomfie profile/home | `run-choomfie.sh` exports `HERMES_HOME`, `CHOOMFIE_HERMES_HOME`, `HERMES_CONFIG`, and `HERMES_PROFILE`. |
| Enable API server/gateway | `run-choomfie.sh` exports `API_SERVER_ENABLED=true` and runs `hermes gateway run`. |
| Set safe defaults | Env/config/toolsets disable global config writes and unsafe tools by default. |
| Avoid global Hermes state | Scripts use Choomfie-specific home and require `install-hermes.sh --local` before cloning. |

## Phase 2: Feature Inventory

| Feature | Current Choomfie | Hermes Native | Port Strategy |
| --- | --- | --- | --- |
| Discord chat | yes | yes | Make Hermes gateway the main path; keep legacy Bun shell as fallback. |
| Voice STT/TTS | yes | partial/yes | Compare after tutor and memory; likely sidecar/plugin at first. |
| Tutor lessons | yes | no/custom | Start skill-first, then promote to plugin for state/SRS/Discord interactions. |
| Memory | yes | yes | Migrate by curated categories, not raw DB dumps. |
| Reminders | yes | cron/tools | Port to Hermes cron plus a reminder skill/tool. |
| Bento-ya tasks | custom | kanban/cron/subagents | Port as Choomfie skill/plugin over Hermes orchestration. |
| Socials | yes | tools/skills | Port selectively; keep legacy integrations until proven. |
| Claude Code bridge | yes | possible | Investigate through Hermes tool/plugin model. |
| Local Ollama | yes | yes | Use Hermes provider routing. |

Initial interpretation:

- Port tutor first because it is distinctive, bounded, and exercises skills, state, memory, tools, and Discord UX.
- Keep Discord hybrid until Hermes gateway feels better than the existing Choomfie Discord shell.
- Keep voice outside the first migration slice because latency, VAD, Discord receive, and interruption behavior are higher-risk.

## Phase 3: First Vertical Slice: Tutor

Recommended approach: skill-first.

Deliverables:

| Deliverable | Status | Notes |
| --- | --- | --- |
| `hermes-overlay/skills/tutor/SKILL.md` | done | Defines tutor behavior and state script usage. |
| `hermes-overlay/skills/tutor/scripts/` | done | Contains dependency-free state/quiz scaffold. |
| `hermes-overlay/skills/tutor/data/` | done | Contains supported modules and seed quiz data. |
| `docs/hermes-tutor-port.md` | done | Captures current Bun tutor source map, skill-first scope, manual test, and promotion path. |

Success criteria:

- Ask Choomfie-Hermes to start a Spanish, Japanese, French, or Chinese learning session.
- Remember active module and level.
- Quiz and correct answers.
- Feel at least as natural as current Choomfie tutor chat.

Current status: the skill scaffold covers module start, active state, deterministic quiz prompts, and correction. It does not yet implement full SRS, Discord buttons, placement tests, or module lesson catalogs.

## Immediate Task Status

| Task | Status | Evidence |
| --- | --- | --- |
| Add `docs/hermes-migration-plan.md` | done | This file exists and includes phase plan, rules, and parity matrix. |
| Create `hermes-overlay/` skeleton | done | Overlay has profiles, skills, plugins, toolsets, config, scripts, and docs directories. |
| Add install/run scripts | done | `install-hermes.sh`, `run-choomfie.sh`, `update-hermes.sh`, and `doctor.sh` exist. |
| Write feature parity matrix | done | Phase 2 table above. |
| Start tutor skill port | done | `hermes-overlay/skills/tutor/` contains `SKILL.md`, data, and script scaffold. |
| Run Hermes live locally with API server enabled | done | Local upstream checkout runs through `hermes-overlay/scripts/hermes-local.sh`; `/v1/models` returned `choomfie` with Bearer auth. |
| Compare current Choomfie, Choomfie shell plus Hermes brain, and direct Hermes overlay | done | Initial comparison captured in `docs/hermes-runtime-comparison.md`; live Discord comparison still needs real Discord/provider credentials. |
| Move legacy Bun runtime aside | done | Previous `packages/` and `plugins/` runtime now lives under `legacy/bun/`; root `bin/choomfie` is Hermes-first and `bin/choomfie-legacy` preserves old Claude Code/Bun launch. |
| Make overlay a Hermes profile distribution | done | `hermes-overlay/distribution.yaml`, root `SOUL.md`, `config.yaml`, and `.env.EXAMPLE` install with `hermes profile install "$PWD/hermes-overlay"`. |

## Phase 4: Memory Migration

Current Choomfie memories should map into:

- profile facts
- long-term memories
- preferences
- recurring workflows
- relationship/personality context

Deliverables:

- `scripts/export-choomfie-memory.ts`
- `scripts/import-to-hermes-memory.sh` or documented manual flow
- `docs/memory-mapping.md`

Rule: do not blindly dump all Choomfie DB rows into Hermes. Curate memory categories first.

## Phase 5: Discord Strategy

Options:

| Option | Benefit | Risk |
| --- | --- | --- |
| Hermes owns Discord | Cleaner long-term and less Choomfie runtime code. | Requires porting Choomfie Discord UX. |
| Choomfie remains Discord shell | Safer transition and preserves voice/tutor interactions. | Keeps two runtimes alive longer. |
| Hybrid | Lets Hermes own normal chat while legacy Choomfie handles special commands/voice. | Requires clear routing rules. |

Recommendation: start hybrid, then move toward Hermes owning Discord if the gateway is strong.

## Phase 6: Voice

Evaluate after tutor and memory.

Required comparison points:

- STT provider
- TTS provider
- VAD
- interruption/barge-in
- Discord voice receive
- streaming partials
- latency

Deliverables:

- `docs/hermes-voice-evaluation.md`
- one test path: voice transcript -> Hermes session -> spoken response
- decision: port Choomfie voice plugin, use Hermes voice, or keep a Choomfie sidecar

Expected outcome: Choomfie voice remains a custom plugin or sidecar until Hermes can match the Discord voice experience.

## Phase 7: Bento-ya / Agents

Port bento-ya orchestration into:

- Hermes cron
- Hermes kanban
- Hermes subagents
- Choomfie-specific skill for task claiming and reporting

Deliverables:

- `hermes-overlay/skills/bento-ya/SKILL.md`
- `hermes-overlay/plugins/choomfie-bentoya/`
- `docs/bentoya-hermes.md`

Success criteria:

- Choomfie-Hermes can claim a task.
- Spawn or delegate work.
- Report progress back to Discord.
- Produce PR-ready output.

## Phase 8: Decide Fate Of Current Bun Choomfie

After two or three vertical slices, decide:

| Outcome | Meaning |
| --- | --- |
| Retire Bun Choomfie | Hermes plus overlay fully replaces it. |
| Keep Bun Choomfie as compatibility shell | Useful for voice and Discord custom commands. |
| Split repos | `choomfie-legacy` and `choomfie-hermes`. |

Expected outcome: Choomfie becomes mostly Hermes overlay, with a small compatibility sidecar for whatever Hermes does not handle beautifully.
