# Socials Plugin — Platform Research

Social media manager plugin for Choomfie. Goal: manage all socials from Discord — post, reply, read, schedule.

## Platform Summary

| Platform | Auth | Cost | Post | Read Feed | DMs | Best Library | Risk |
|----------|------|------|------|-----------|-----|--------------|------|
| **Twitter/X** | OAuth 2.0 | Free (post only) or $200/mo (read+post) | Yes | $200/mo or unofficial | Unofficial only | `twitter-api-v2` + `agent-twitter-client` | Medium |
| **LinkedIn** | OAuth 2.0 | Free | Yes | Own posts only | No API | Raw `fetch` (no good lib) | Low |
| **Instagram** | OAuth 2.0 | Free | Yes (Business acct) | Own media only | Messenger API (review) | Raw `fetch` + `instagrapi` (Python) | Medium-High |
| **YouTube** | OAuth 2.0 / API key | Free (10K quota/day) | Comments + uploads | Via API key | N/A | `googleapis` + `yt-dlp` | Low |
| **Reddit** | OAuth 2.0 | Free (100 req/min) | Yes | Yes | Yes | Raw `fetch` wrapper | Low |

## Twitter/X

### API Tiers
- **Free ($0)**: Post only, 1,500/mo, no reading/search
- **Basic ($200/mo)**: Post + read + 7-day search
- **Pro ($5,000/mo)**: Full archive search, streams
- **DMs**: Enterprise only (official) or unofficial

### Recommended Approach: Hybrid
- `agent-twitter-client` (unofficial, free) — full posting, reading, DMs, search. Used by AI agent ecosystem (ElizaOS). Risk of account suspension.
- `twitter-api-v2` (official) — fallback for posting if unofficial breaks
- Config-driven provider selection

### Actions Available
| Action | Free API | Basic ($200) | Unofficial (free) |
|--------|----------|--------------|-------------------|
| Post tweet | 50/day | 100/day | Unlimited* |
| Reply/RT/Quote | Yes | Yes | Yes |
| Read timeline | No | Yes | Yes |
| Search | No | 7-day | Yes |
| DMs | No | No | Yes |
| Like | No | Yes | Yes |

### Packages
```bash
bun add twitter-api-v2 agent-twitter-client
```

---

## LinkedIn

### API Access
- Community Management API (free, requires approval)
- OAuth 2.0 with redirect (needs lightweight web server for callback)
- Approval takes 1-4 weeks

### What Works
- Post text/images/articles/documents/video
- Comment, reply, react to posts
- Read own posts + analytics (company pages)
- **Cannot**: Read feed, send DMs, search users, manage connections

### Recommended Approach
- Raw `fetch` against REST API (no good Node.js library exists)
- Official API only (unofficial = high ban risk)
- OAuth token stored in SQLite with refresh logic

### Packages
```bash
# No packages needed — raw fetch is sufficient
# LinkedIn REST API is straightforward
```

---

## Instagram

### Requirements
- **Business or Creator account** (linked to Facebook Page) for Graph API
- **Meta App Review** required for production (slow, weeks-months)
- Basic Display API deprecated Dec 2024

### What Works (Official Graph API)
- Publish photos, reels, stories, carousels
- Read/reply/moderate comments
- Analytics/insights
- **Cannot**: Read home feed, like posts, follow/unfollow, DMs (without Messenger API review)

### Unofficial Option
- `instagrapi` (Python) — most capable, actively maintained. Run as subprocess.
- Node.js options (`instagram-private-api`) are effectively dead
- **Risk**: Ban is common, Instagram detection has improved significantly

### Recommended Approach
- Official Graph API for publishing + comments
- `instagrapi` (Python subprocess) for DMs/feed if needed
- Use burner account for testing, never primary brand account

### Packages
```bash
pip install instagrapi  # Python, for unofficial features
# Official API via raw fetch
```

---

## YouTube

### API Quota (Free)
- 10,000 units/day
- Search: 100 units/call (~100 searches/day)
- Upload: 1,600 units/call (~6 uploads/day)
- Comments: 50 units/call (~200 comments/day)
- Read video details: 1 unit/call

### What Works
- Search videos, get details, list comments
- Post/reply to comments
- Upload videos/shorts
- Manage playlists
- **Cannot**: Community posts (no API), create polls

### Recommended Approach
- `googleapis` for write operations (comments, uploads)
- `yt-dlp` (subprocess) for metadata extraction + transcripts (quota-free)

### Packages
```bash
bun add googleapis
brew install yt-dlp  # or pip install yt-dlp
```

---

## Reddit

### API (Free)
- 100 requests/min (144K/day) — very generous
- OAuth 2.0 password grant for script apps
- No cost for non-commercial bots

### What Works
- Post text/links, comment, reply
- Upvote/downvote
- Search posts, browse subreddits
- Read/send DMs
- Moderation (if bot is mod)
- **Cannot**: Create subreddits, native polls, gallery posts (complex)

### Recommended Approach
- Raw `fetch` wrapper (~200 lines) — better than dead libraries
- Skip `snoowrap` (abandoned since 2022)
- Already have provider scaffolding in the plugin

### Packages
```bash
# No packages needed — thin fetch wrapper over Reddit REST API
```

---

## Implementation Priority

Based on API accessibility, usefulness, and effort:

| Priority | Platform | Why |
|----------|----------|-----|
| 1 | **Reddit** | Free, generous API, already scaffolded, full read+write |
| 2 | **LinkedIn** | Free, straightforward posting API, high personal brand value |
| 3 | **Twitter/X** | Most used, but API cost or ban risk. Unofficial client is viable. |
| 4 | **YouTube** | Good for comment management + transcripts. Quota is tight. |
| 5 | **Instagram** | Most painful — Business acct + Meta review + ban risk for unofficial |

## Architecture

```
packages/socials/
├── index.ts                    # Plugin entry, aggregates all platform tools
├── tools.ts                    # MCP tool definitions (per-platform)
├── auth.ts                     # OAuth flow manager (shared across platforms)
├── providers/
│   ├── types.ts                # Shared interfaces (Post, Comment, etc.)
│   ├── index.ts                # Provider factory
│   ├── twitter/
│   │   ├── official.ts         # twitter-api-v2 wrapper
│   │   └── agent.ts           # agent-twitter-client wrapper
│   ├── linkedin/
│   │   └── api.ts             # Raw fetch against LinkedIn REST API
│   ├── instagram/
│   │   ├── graph.ts           # Official Graph API
│   │   └── unofficial.ts      # instagrapi Python bridge
│   ├── youtube/
│   │   ├── api.ts             # googleapis wrapper
│   │   └── yt-dlp.ts          # yt-dlp subprocess for metadata/transcripts
│   └── reddit/
│       └── api.ts             # Raw fetch wrapper
└── scheduler.ts               # Post scheduling (cron-based, stored in SQLite)
```

## Shared Features (Cross-Platform)

- **Unified post tool**: "Post this to Twitter and LinkedIn" → formats for each platform
- **Post scheduling**: Queue posts for specific times (SQLite + setTimeout, like reminders)
- **Approval flow**: Draft → preview in Discord embed → owner approves → publish
- **Analytics digest**: Scheduled summary of engagement across platforms
- **OAuth setup wizard**: `/socials setup twitter` → walks through auth flow
