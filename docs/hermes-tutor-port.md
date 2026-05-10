# Hermes Tutor Port

The first Choomfie-to-Hermes vertical slice is the tutor.

## Why Tutor First

- It is distinctive Choomfie behavior.
- It has clearer boundaries than voice or Discord gateway ownership.
- It exercises skills, state, memory, tools, and Discord UX.
- It can start as a skill and become a plugin only if needed.

## Current Choomfie Source

The current Bun tutor lives under `legacy/bun/plugins/tutor/`.

Important pieces:

| Area | Current Path |
| --- | --- |
| Plugin entry | `legacy/bun/plugins/tutor/index.ts` |
| Lesson engine | `legacy/bun/plugins/tutor/core/lesson-engine.ts` |
| Lesson DB | `legacy/bun/plugins/tutor/core/lesson-db.ts` |
| Learner profile | `legacy/bun/plugins/tutor/core/learner-profile.ts` |
| SRS | `legacy/bun/plugins/tutor/core/srs.ts` |
| Modules | `legacy/bun/plugins/tutor/modules/` |
| Tools | `legacy/bun/plugins/tutor/tools/` |
| Discord interactions | `legacy/bun/plugins/tutor/lesson-interactions.ts` |

## Skill-First Port

The initial Hermes overlay skill lives at `hermes-overlay/skills/tutor/`.

It provides:

- `SKILL.md` for Hermes behavior instructions.
- `data/modules.json` for supported modules and default levels.
- `data/quiz-seeds.json` for deterministic starter quizzes.
- `scripts/tutor-state.mjs` for active module/level state and basic answer checking.

This is intentionally small. It proves that Choomfie-Hermes can start and resume a learning session without needing to port the whole Bun plugin.

## Manual Test

```bash
export CHOOMFIE_HERMES_HOME="$(mktemp -d)"
node hermes-overlay/skills/tutor/scripts/tutor-state.mjs start japanese beginner
node hermes-overlay/skills/tutor/scripts/tutor-state.mjs quiz
node hermes-overlay/skills/tutor/scripts/tutor-state.mjs answer japanese-beginner-001 hello
node hermes-overlay/skills/tutor/scripts/tutor-state.mjs get
```

Expected result:

- `start` sets `activeModule` to `japanese` and `level` to `beginner`.
- `quiz` emits a Japanese beginner prompt.
- `answer` returns `correct: true` for `hello`.
- `get` shows persisted state under `CHOOMFIE_HERMES_HOME`.

## Promotion Path

Promote from skill to plugin when the port needs:

- durable SRS scheduling
- structured lesson catalogs
- concurrent per-user state
- Discord buttons or slash commands
- placement tests
- XP, streaks, or analytics

## Next Work

1. Map existing module APIs into Hermes skill/tool calls.
2. Add a curated import of Japanese/French/Spanish/Chinese lesson metadata.
3. Decide whether SRS state belongs in Hermes memory, a plugin store, or a bridge from the existing SQLite data.
4. Test through the Hermes API server with a real Choomfie-Hermes session.
