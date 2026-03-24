# Roadmap

## Phase 1: Foundation (Current)

Get the basics working end-to-end.

- [x] Project scaffold and repo
- [x] Core agent wrapper (`claude --print`)
- [x] Terminal REPL with `/memory` and `/remember`
- [x] SQLite memory store (core + archival)
- [x] Skills registry
- [x] Discord bot adapter
- [x] Documentation
- [ ] `npm install` and verify everything runs
- [ ] Discord bot tested in a real server
- [ ] Terminal REPL tested with real Claude Code CLI

## Phase 2: Agent SDK Migration

Replace `claude --print` with the official Agent SDK for streaming, tool control, and session management.

- [ ] Migrate to `@anthropic-ai/claude-agent-sdk` subprocess API
- [ ] Streaming responses (show typing indicator, stream chunks)
- [ ] Session persistence (resume conversations)
- [ ] Tool use hooks (intercept/approve tool calls)
- [ ] MCP server integration

## Phase 3: Smart Memory

Make memory more intelligent and agent-driven.

- [ ] Agent self-editing memory (agent calls `setCoreMemory` during conversations)
- [ ] Conversation summarization → archival memory
- [ ] Cross-session recall (auto-search archival when context seems relevant)
- [ ] Vector embeddings for semantic archival search
- [ ] Memory decay / auto-archiving stale core memories
- [ ] claude-mem integration for session-level learning

## Phase 4: Skills Expansion

Build out the skills ecosystem.

- [ ] Built-in skills: web search, file ops, shell commands
- [ ] `manage_memory` skill — agent manages its own memory
- [ ] `schedule_task` skill — cron-based recurring tasks
- [ ] `browse_url` skill — fetch and summarize web pages
- [ ] Skill hot-reloading (add skills without restart)
- [ ] Skill marketplace / community skills format

## Phase 5: More Channels

Expand beyond Discord and terminal.

- [ ] Slack adapter
- [ ] Telegram adapter
- [ ] Web UI (simple chat interface)
- [ ] iMessage integration (macOS)

## Phase 6: Autonomous Agent

Hermes-level autonomy.

- [ ] Background tasks — agent works on things while you're away
- [ ] Cron scheduling — natural language scheduled tasks ("check my PRs every morning")
- [ ] Multi-agent — spawn sub-agents for parallel work
- [ ] Learning loop — agent creates skills from repeated complex tasks
- [ ] Proactive suggestions — agent notices patterns and offers help

## Phase 7: Polish

- [ ] Admin dashboard (web UI for config, memory browser, skill management)
- [ ] Rate limiting and safety guardrails
- [ ] Logging and observability
- [ ] Docker deployment option
- [ ] Documentation site

## Non-Goals (For Now)

Things we're intentionally not building:

- **Voice support** — adds significant complexity, not needed for v1
- **Multi-user** — Ryuji is a personal assistant, not a platform
- **Custom model training** — we use Claude as-is
- **Mobile app** — Discord/Telegram mobile apps cover this
