# Browser Plugin — Research (Updated March 2026)

## Executive Summary

The landscape has matured. For **social media automation** (Facebook, Reddit, LinkedIn), vanilla Playwright gets detected and blocked — you need stealth capabilities. For **dev/testing**, Playwright MCP or CLI is still king.

**Recommendation: Two browsers** — clean Playwright for dev/testing, stealth browser for social media.

## MCP Browser Servers (Plug Into Claude Code Today)

### 1. Playwright MCP (Microsoft) — The Baseline

**What:** Official Microsoft MCP server. 22 tools.
**Repo:** github.com/microsoft/playwright-mcp | Free
**Install:** `npx @playwright/mcp@latest`

- Now supports `--persistent` flag and `--profile=<path>` for session persistence
- `--storage-state=<file>` loads cookies from JSON
- Chrome extension "Playwright MCP Bridge" connects to your existing logged-in Chrome
- Microsoft now also offers **Playwright CLI** (`@playwright/cli`) — 4x fewer tokens than MCP (27K vs 114K per session)
- **Weakness:** Zero stealth. Facebook/LinkedIn/Instagram will detect and block immediately.
- **Best for:** Dev/testing, sites that don't have anti-bot

### 2. BrowserMCP — Uses Your Real Browser

**What:** Chrome extension + local MCP server. Automates your existing Chrome profile.
**Site:** browsermcp.io | Free

- You're already logged into everything — no separate login needed
- Real browser fingerprint = minimal anti-bot detection
- Works with Claude Code, Cursor, VS Code
- **Weakness:** Limited to Chrome extension API. No headless mode. Less programmatic control.
- **Best for:** Quick tasks on sites you're already logged into

### 3. Stealth Browser MCP — The Heavy Hitter

**What:** nodriver + Chrome DevTools Protocol + FastMCP. 90 tools across 11 categories.
**Repo:** github.com/vibheksoni/stealth-browser-mcp | Free
**Install:** `uvx stealth-browser-mcp`

- Bypasses Cloudflare, Queue-It, and social media anti-bot (98.7% success rate)
- AI agents can write custom Python network hooks (intercept/modify traffic)
- Persistent Chrome sessions with real profiles
- **Weakness:** Python-based (runs as sidecar MCP server)
- **Best for:** Facebook/Reddit/LinkedIn automation, scraping protected sites

### 4. Patchright MCP — Stealth Playwright

**What:** Patched Playwright that removes all automation detection signals.
**Repo:** github.com/dylangroos/patchright-mcp-lite | Free

- navigator.webdriver removed, CDP leaks patched, fingerprint fixed
- Currently considered undetectable by most anti-bot systems
- Same Playwright API — drop-in replacement
- **Weakness:** Chromium-only
- **Best for:** If you want Playwright-like control with stealth

### 5. Stagehand MCP — AI-Native

**What:** Browserbase's AI browser SDK with act/observe/extract APIs.
**Repo:** github.com/browserbase/stagehand (v3.2.0, March 2026) | MIT

- v3: complete rewrite, dropped Playwright, CDP-native, 44% faster
- Action caching cuts token costs, self-healing execution
- npm MCP server (`stagehand-mcp`) is outdated (v2). Need Browserbase hosted or custom wrapper.
- **Weakness:** Designed for Browserbase cloud. Local setup is more work. No built-in stealth.
- **Best for:** AI-native "act/observe/extract" when you don't know the page structure

### 6. Bright Data Social Media MCP — Managed Scraping

**What:** Managed proxy + browser infrastructure with dedicated social media MCP.
**Site:** brightdata.com | Free tier: 5,000 req/month

- Built-in anti-bot bypass via residential IP rotation
- Handles infinite scroll, screenshots, 90% accuracy
- **Weakness:** Not self-hosted. Vendor lock-in beyond free tier.
- **Best for:** If you want zero-maintenance social media scraping

## AI Browser Agents (Not MCP)

| Agent | Status (March 2026) | Verdict |
|-------|---------------------|---------|
| **Anthropic Computer Use** | Research preview (macOS, Pro/Max). Claude controls your desktop. | Game-changing future. Too early for production. |
| **browser-use (TypeScript)** | v0.6.0, published March 2026. Has MCP SDK dependency. | Very new but promising. 89% WebVoyager score. |
| **OpenAI Operator** | **Shut down** Aug 2025. Replaced by ChatGPT Agent. | Dead. Skip. |
| **Fellou** | 1M+ users. Closed-source consumer browser app. | End-user product, no API. Not useful for us. |
| **Convergence/Proxy** | Acquired by Salesforce. `proxy-lite` open-weights model available. | Research interest only. |

## Session/Auth Management

| Tool | Login Persistence | Stealth | 2FA |
|------|------------------|---------|-----|
| **Playwright MCP** | `--persistent` / `--profile` / `--storage-state` | None | Manual first login |
| **BrowserMCP** | Your real Chrome profile | Native (real browser) | Whatever Chrome has |
| **Stealth Browser MCP** | Persistent Chrome profiles | nodriver + CDP patches | Manual first login |
| **Patchright MCP** | Same as Playwright | Anti-detection patches | Manual first login |

## Recommendation for Our Use Cases

### Social Media Automation (Facebook groups, Reddit, LinkedIn)

**Primary: Stealth Browser MCP**
- 90 tools, anti-bot bypass, persistent sessions
- Run as sidecar MCP server: `uvx stealth-browser-mcp`
- Handles Facebook, Reddit, LinkedIn without getting blocked

**Alternative: Patchright MCP**
- Stays in Playwright/TypeScript ecosystem
- Undetectable Playwright fork with MCP wrapper
- Fewer tools but familiar API

**Quick one-off: BrowserMCP**
- Install Chrome extension, use your already-logged-in browser
- Zero friction for "just do this one thing on Facebook"

### Dev/Testing Web Apps

**Primary: Playwright CLI** (`@playwright/cli`)
- 4x fewer tokens than MCP
- Best for Claude Code (saves snapshots to disk)

**Fallback: Playwright MCP** — already set up, works fine

### Suggested MCP Setup

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--persistent"]
    },
    "stealth-browser": {
      "command": "uvx",
      "args": ["stealth-browser-mcp"]
    }
  }
}
```

Two browsers: clean Playwright for dev/testing, stealth for social media.

## What's New in 2026

1. **Playwright CLI** (March 2026) — 4x fewer tokens than MCP for coding agents
2. **Anthropic Computer Use** (March 24, 2026) — Claude controls your Mac desktop natively
3. **Stagehand v3** (Feb 2026) — CDP-native, 44% faster, self-healing
4. **browser-use TypeScript** (March 2026) — Finally a proper TS version with MCP SDK
5. **Stealth Browser MCP** — 90-tool MCP server with anti-bot bypass

## Eliminated Options

| Tool | Why Eliminated |
|------|---------------|
| Selenium | Legacy, slower, no advantages |
| browser-use Python | Python-only, need subprocess |
| LaVague | Stalled since Jan 2025 |
| Dendrite | Abandoned |
| Multion | Cloud-only paid |
| OpenAI Operator | Shut down |
| Fellou | Closed-source consumer product |

## Implementation Priority

1. **Add Stealth Browser MCP** — `uvx stealth-browser-mcp` in .mcp.json
2. **Log into Facebook/Reddit/LinkedIn** — manual first login, sessions persist
3. **Build automation workflows** — scrape housing groups, post to socials
4. **Add Playwright CLI** for dev/testing (optional, Playwright MCP works fine)
5. **Evaluate BrowserMCP** for quick ad-hoc tasks
