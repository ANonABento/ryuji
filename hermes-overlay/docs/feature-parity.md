# Feature Parity

Canonical parity matrix: `docs/hermes-migration-plan.md`.

## Current Snapshot

| Feature | Current Choomfie | Hermes Native | Port Strategy |
| --- | --- | --- | --- |
| Discord chat | yes | yes | Start hybrid: Choomfie shell plus Hermes API/gateway. |
| Voice STT/TTS | yes | partial/yes | Evaluate after tutor and memory. |
| Tutor lessons | yes | custom skill/plugin | Skill-first port, promote to plugin if constrained. |
| Memory | yes | yes | Curate categories and bridge/migrate carefully. |
| Reminders | yes | cron/tools | Port to Hermes cron and reminder skill. |
| Bento-ya tasks | custom | kanban/cron/subagents | Skill/plugin over Hermes orchestration. |
| Socials | yes | tools/skills | Port selectively. |
| Claude Code bridge | yes | possible | Investigate after hybrid brain path. |
| Local Ollama | yes | yes | Use Hermes provider routing. |

