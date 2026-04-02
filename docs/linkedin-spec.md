# LinkedIn Integration Spec

> Full LinkedIn integration for Choomfie — posting, media, scheduling, comment monitoring, and engagement.

## Current State (v0.4.0)

Working:
- OAuth 2.0 (standard 3-legged, no PKCE — LinkedIn rejects PKCE for "Share on LinkedIn")
- Token refresh with 5-min buffer before expiry
- Text posts via Posts API (`/rest/posts`, LinkedIn-Version: 202603)
- Image posts (single image, URL or local file)
- Multi-image posts (2-20 images, parallel upload)
- Link/article posts with metadata (title, description)
- Delete posts
- Read comments on own posts
- Comment on posts
- React to posts (like/celebrate/support/love/insightful/funny)
- Profile fetch via OpenID userinfo
- Comment monitoring with auto-polling (every 5 min, forwards to Discord)
- Auto-track posts for monitoring when created
- Post scheduling with queue management (SQLite + setTimeout)
- First-comment automation (auto-posts comment after scheduled post)
- Notification callbacks for posted/failed scheduled posts
- Engagement analytics (likes, comments, top posts)
- Like count tracking during comment polls
- Edit post text (PARTIAL_UPDATE)
- Polls (2-4 options, 1/3/7/14 day duration)
- Repost/reshare with optional commentary
- 17 MCP tools: `linkedin_auth`, `linkedin_post`, `linkedin_post_image`, `linkedin_post_images`, `linkedin_post_link`, `linkedin_edit`, `linkedin_poll`, `linkedin_repost`, `linkedin_delete`, `linkedin_comments`, `linkedin_comment`, `linkedin_react`, `linkedin_schedule`, `linkedin_queue`, `linkedin_monitor`, `linkedin_analytics`, `linkedin_status`

Scopes: `openid`, `profile`, `w_member_social`

## API Migration — DONE

Migrated from deprecated `POST /v2/ugcPosts` (LinkedIn-Version: 202401) to `POST /rest/posts` (LinkedIn-Version: 202603). The new Posts API has a flatter payload structure.

### Payload Comparison

```
# Old (ugcPosts)                          # New (Posts API)
POST /v2/ugcPosts                         POST /rest/posts
{                                         {
  author: "urn:li:person:X",                author: "urn:li:person:X",
  lifecycleState: "PUBLISHED",              lifecycleState: "PUBLISHED",
  specificContent: {                        commentary: "post text here",
    "com.linkedin.ugc.ShareContent": {      visibility: "PUBLIC",
      shareCommentary: { text },            distribution: {
      shareMediaCategory: "NONE"              feedDistribution: "MAIN_FEED"
    }                                       }
  },                                      }
  visibility: {
    "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
  }
}
```

## Feature Roadmap

### Phase 1 — Foundation (fix + essential tools)

1. **Migrate to Posts API** (`/rest/posts`)
   - Update `LINKEDIN_API_BASE` to `/rest`
   - Update `LINKEDIN_VERSION` to `202601`
   - Rewrite `post()` payload to new format
   - Remove RestLi protocol version header

2. **Delete post** — `DELETE /rest/posts/{post-urn}`
   - Store post URNs in SQLite for reference
   - New tool: `linkedin_delete`

3. **Edit post** — `POST /rest/posts/{post-urn}` with updated content
   - New tool: `linkedin_edit`

4. **Link/article posts** — include URL with metadata
   - Manual `title`, `description`, `thumbnail` fields (no auto-scrape in Posts API)
   - New param on `linkedin_post`: optional `url`, `link_title`, `link_description`

### Phase 2 — Media

5. **Image posts** (single)
   - 3-step flow: `POST /rest/images?action=initializeUpload` → PUT binary → create post with image URN
   - Accept image URL or Discord attachment path
   - New tool: `linkedin_post_image`

6. **Multi-image posts**
   - Same upload flow, 2-20 images per post
   - MultiImage API endpoint

7. **Document/carousel posts**
   - Upload PDF/PPTX via Documents API → post with document URN
   - LinkedIn renders each page as a swipeable slide
   - 3-5x engagement vs text posts
   - New tool: `linkedin_post_carousel`

8. **Video posts** (stretch)
   - Chunked upload via Videos API
   - Max 5GB, up to 720p
   - Supports thumbnails + caption files

### Phase 3 — Engagement & Monitoring

9. **Comment polling**
   - Store post URNs when posting (SQLite table: `linkedin_posts`)
   - Background poll for new comments via Comments API
   - Forward new comments to Discord as notifications
   - Poll interval: configurable, default every 5 min

10. **Reply to comments**
    - Comments API: `POST /rest/socialActions/{post-urn}/comments`
    - Two modes:
      - **Manual:** forward comment to Discord, user tells Choomfie what to reply
      - **Draft:** Claude generates reply, sends to Discord for approval before posting
    - New tool: `linkedin_reply_comment`

11. **React to posts**
    - Reactions API: `POST /rest/socialActions/{post-urn}/likes`
    - Support LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY
    - New tool: `linkedin_react`

12. **Read comments on own posts**
    - `GET /rest/socialActions/{post-urn}/comments`
    - New tool: `linkedin_comments`

### Phase 4 — Scheduling & Content

13. **Post scheduling**
    - SQLite table: `linkedin_queue` (text, media_urls, scheduled_at, status)
    - Timer-based firing (same pattern as ReminderScheduler)
    - Discord command to manage queue: view, edit, cancel scheduled posts
    - New tools: `linkedin_schedule`, `linkedin_queue`

14. **Content generation**
    - Claude drafts LinkedIn posts from a topic/tone
    - Preview in Discord embed before posting
    - Hashtag suggestions (3-5 per post, optimal for algorithm)
    - New tool: `linkedin_draft`

15. **First-comment automation**
    - After posting, immediately add a comment with CTA/link
    - LinkedIn algo favors posts with early comments
    - Optional param on `linkedin_post`: `first_comment`

16. **Cross-post from Discord**
    - "Post this to LinkedIn" on any Discord message
    - Reformat: strip Discord syntax, add line breaks, suggest hashtags
    - Preview before posting

### Phase 5 — Analytics (limited)

17. **Basic engagement tracking**
    - Store post URNs + timestamps
    - Poll reactions/comments count periodically
    - Show engagement summary in Discord: "your post from Tuesday has 15 likes, 3 comments"
    - SQLite table: `linkedin_post_stats`

18. **Content performance**
    - Track which post types/times get most engagement
    - Suggest best posting times based on history

## Database Schema

```sql
-- Track posted content
CREATE TABLE linkedin_posts (
  id INTEGER PRIMARY KEY,
  post_urn TEXT NOT NULL,
  text TEXT,
  media_type TEXT, -- 'text', 'image', 'carousel', 'video', 'article'
  posted_at TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  last_checked TEXT
);

-- Scheduled posts queue
CREATE TABLE linkedin_queue (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  media_urls TEXT, -- JSON array
  media_type TEXT DEFAULT 'text',
  first_comment TEXT,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, posted, cancelled
  post_urn TEXT,
  created_at TEXT NOT NULL
);

-- Comment tracking (for notification dedup)
CREATE TABLE linkedin_comments (
  id INTEGER PRIMARY KEY,
  post_urn TEXT NOT NULL,
  comment_urn TEXT NOT NULL,
  author_name TEXT,
  text TEXT,
  seen_at TEXT NOT NULL
);
```

## File Structure

```
packages/socials/providers/linkedin/
  api.ts            # (existing) OAuth + core API methods
  posts.ts          # NEW: Posts API (create, edit, delete, media upload)
  comments.ts       # NEW: Comments + reactions API
  scheduler.ts      # NEW: Post queue + scheduling (SQLite)
  monitor.ts        # NEW: Comment polling + Discord notifications
  types.ts          # NEW: Shared LinkedIn types
```

## API Endpoints Reference

### Available with `w_member_social` (current scope)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/posts` | POST | Create post (text, image, video, article, poll) |
| `/rest/posts/{urn}` | POST | Edit post |
| `/rest/posts/{urn}` | DELETE | Delete post |
| `/rest/images?action=initializeUpload` | POST | Start image upload |
| `/rest/videos?action=initializeUpload` | POST | Start video upload |
| `/rest/documents?action=initializeUpload` | POST | Start document upload |
| `/rest/socialActions/{urn}/comments` | GET/POST | Read/write comments |
| `/rest/socialActions/{urn}/likes` | GET/POST | Read/write reactions |
| `/rest/polls` | POST | Create poll (used with Posts API) |

### NOT available (need additional products)

| Feature | Required Product | Status |
|---------|-----------------|--------|
| Post analytics | Member Post Analytics API | Partner-only (2025) |
| Company page posts | Community Management API | Requires app review |
| Read feed | N/A | No API exists |
| DMs/messaging | N/A | No public API |
| Connection list | N/A | Removed |

## Rate Limits

LinkedIn doesn't publish exact limits. Monitor response headers:
- `X-RateLimit-Limit` — max requests
- `X-RateLimit-Remaining` — remaining quota

General guidance: don't post more than a few times per day, don't poll comments more than every 5 min.

## Notes

- LinkedIn strips markdown. Posts are plain text only. Line breaks (`\n`) are preserved.
- Hashtags: just include `#hashtag` in text. Optimal 3-5 per post.
- @Mentions: use annotation objects with URNs and text ranges.
- Token lasts ~60 days with no refresh token (current "Share on LinkedIn" product).
- Auth link must be opened on the same machine running the bot (localhost:9876 callback).
- PKCE does NOT work — LinkedIn rejects with `invalid_client`. Use standard OAuth only.
