# Architecture Optimization — Token & Context Analysis

## Current State (64 tools, ~7,180 tokens overhead)

| Group | Tools | Tokens | % |
|-------|-------|--------|---|
| Core Discord | 9 | ~1,250 | 17% |
| Core Memory/Persona | 10 | ~730 | 10% |
| Core Reminders/Other | 10 | ~950 | 13% |
| Plugin: Socials | 14 | ~1,230 | 17% |
| Plugin: Language Learning | 10 | ~790 | 11% |
| Plugin: Browser | 7 | ~550 | 8% |
| Plugin: Voice | 3 | ~240 | 3% |
| System prompt | — | ~1,240 | 17% |
| **Total overhead** | **64** | **~7,180** | **2.9% of 200K context** |

## Options Evaluated

### Option A: Current (Monolithic) — Baseline
- 7,180 tokens/request, 0 extra latency, already built
- Works fine at current scale

### Option B: Chat + Tool Worker Split — ❌ Does NOT Save Tokens
- Workers are behind the supervisor. Claude talks to one MCP server.
- Supervisor's ListTools returns ALL tools regardless of worker count.
- Good for crash isolation, NOT for token reduction.

### Option C: Plugin-Specific Workers — ❌ Same Problem
- Same as B. Multiple workers don't change what Claude sees.

### Option D: Lazy Loading via tools/list_changed — ❌ Breaks Cache
- Every tools/list_changed invalidates prompt cache
- Cache re-processing cost exceeds token savings
- Anti-pattern for multi-turn conversations

### Option E: Tool Proxy Pattern — Viable (57% token reduction)
- One `use_plugin(plugin, action, args)` meta-tool replaces 34 plugin tools
- Overhead drops to ~3,100 tokens
- Cache perfectly preserved (tool list never changes)
- **Downside:** Claude must guess arg schemas. Accuracy degrades for complex tools.
- Best for plugins with simple, predictable schemas

### Option F: Deferred Loading (ToolSearch) — ⭐ Best (Already Active)
- Claude Code already defers our tools (visible in `<system-reminder>` blocks)
- Core tools loaded, plugin tools deferred (names only ~50 tokens each)
- ToolSearch fetches full schema on demand, injected inline (preserves cache)
- Overhead: ~4,800 tokens (33% reduction)
- **Zero implementation effort** — it's a Claude Code feature

## Model Routing (Not Currently Feasible)

| Mix | Cost/1K Requests |
|-----|-----------------|
| All Opus | $35.90 |
| 90% Haiku + 10% Opus | $10.47 (71% savings) |
| 90% Haiku + 10% Sonnet | $8.62 (76% savings) |

Blocked: Choomfie is an MCP plugin — model is set at Claude Code session level, not per-request. Would need to become a standalone agent with own API calls.

## Mid-Session Tool Registration Issue

**Root cause:** Claude Code's ToolSearch index is built at session start and doesn't refresh when `tools/list_changed` fires. New plugin tools are in MCP but not discoverable via search.

**Fix:** Enable all plugins before starting Claude Code session. This is a client-side limitation, not a server bug.

## Scaling Projections

| Scale | Tools | Schema Tokens | % of Context |
|-------|-------|---------------|-------------|
| Current | 64 | ~5,740 | 2.9% |
| +5 plugins | ~139 | ~12,500 | 6.3% |
| +10 plugins | ~214 | ~19,300 | 9.7% |

**Action threshold:** Revisit architecture at 100+ tools or when tool selection accuracy visibly degrades.

## Recommended Actions (Priority Order)

1. **Do nothing** — 2.9% context overhead is fine. Claude Code deferred loading already works.
2. **Enable plugins before starting sessions** — avoids the ToolSearch cache issue.
3. **If optimizing:** Slim schemas (shorter descriptions), proxy pattern for socials (14→1 tool), consolidate language-learning tools (10→4).
4. **Future:** If we need model routing, consider making Choomfie a standalone agent instead of MCP plugin.
