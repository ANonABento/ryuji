# Google Integration Spec

> Shared Google auth + services via gogcli. Not a plugin — lib-level infrastructure.

## Overview

Google services integration using [gogcli](https://gogcli.sh/) as the CLI backend. Provides birthday tracking, memory backup to Sheets, and a foundation for Calendar/Gmail/Drive features.

## Architecture

```
lib/google/
  auth.ts          # Check gogcli auth status, account selection
  sheets.ts        # Read/write Google Sheets (memory backup, birthday index)
  calendar.ts      # (Future) Calendar events, birthday calendar sync
  drive.ts         # (Future) File backup, SQLite DB sync
```

gogcli is invoked via `Bun.spawn()` (not MCP — more token-efficient). Auth is handled by gogcli itself (`gog auth add`).

### Why Not a Plugin?

Google auth is shared infrastructure. Multiple features use it:
- Sheets for memory backup + birthday index
- Calendar for birthday reminders + scheduling (future)
- Drive for DB backup (future)
- Gmail for notifications (future)

Plugins are isolated feature bundles. Google cuts across features → lib-level.

---

## Feature 1: Birthday Index

### Storage

New SQLite table in existing DB:

```sql
CREATE TABLE IF NOT EXISTS birthdays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,              -- Discord user ID (nullable for non-Discord people)
  name TEXT NOT NULL,        -- Display name
  birthday TEXT NOT NULL,    -- MM-DD format
  year INTEGER,              -- Birth year (nullable, not everyone shares this)
  notes TEXT,                -- Optional notes ("likes chocolate cake")
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name)               -- One entry per person
);
```

### MCP Tools (owner-only)

| Tool | Description |
|------|-------------|
| `birthday_add` | Add/update a birthday. Params: `name`, `birthday` (MM-DD), `year?`, `user_id?`, `notes?` |
| `birthday_remove` | Remove by name |
| `birthday_list` | List all birthdays, sorted by next occurrence |
| `birthday_upcoming` | Show birthdays in the next N days (default 30) |

### Daily Check

On worker startup + every 24h (setTimeout-based, like reminders):
1. Query birthdays where `birthday = today's MM-DD`
2. Send notification to owner DM via MCP notification
3. Also check upcoming (next 7 days) for heads-up

### Slash Command

`/birthdays` — embed showing upcoming birthdays with countdown

### Google Sheets Sync (Optional)

If Sheets is configured, maintain a "Birthdays" sheet as a readable mirror:
- Columns: Name | Birthday | Year | Age | Notes
- Sync on add/remove/update
- Two-way sync future stretch goal (edit in Sheets → reflected in bot)

---

## Feature 2: Memory Backup to Google Sheets

### How It Works

Periodic export of SQLite memories to a Google Sheet for durability + browsability.

**Sheet Structure:**

Sheet 1 — "Core Memories":
| Key | Value | Created | Updated |
|-----|-------|---------|---------|

Sheet 2 — "Archival Memories":
| Key | Value | Tags | Created |
|-----|-------|------|---------|

Sheet 3 — "Birthdays":
| Name | Birthday | Year | Age | Notes |
|------|----------|------|-----|-------|

### Sync Strategy

- **On change:** After any `save_memory`, `delete_memory`, `birthday_add`, `birthday_remove` → queue a sync
- **Debounced:** Max once per 5 minutes to avoid API spam
- **Full sync:** On startup, compare DB vs Sheet, reconcile

### MCP Tools

| Tool | Description |
|------|-------------|
| `memory_sync` | Force sync memories to Sheets now |
| `memory_backup_status` | Show last sync time, sheet URL, row counts |

### gogcli Commands

```bash
# Create spreadsheet
gog sheets create --title "Choomfie Memory Backup"

# Write data
gog sheets write --spreadsheet-id <id> --range "Core Memories!A1" --values '[["Key","Value","Created","Updated"], ...]'

# Read data
gog sheets read --spreadsheet-id <id> --range "Core Memories!A:D"
```

---

## Feature 3: Broader gogcli Capabilities

Things we can do once Google auth is working:

### Calendar
- **Birthday calendar:** Auto-create recurring birthday events
- **Daily briefing:** "Good morning" with today's events
- **Reminder sync:** Choomfie reminders ↔ Google Calendar events
- **Availability check:** "Am I free Thursday at 3pm?"

### Gmail
- **Unread count:** Quick check without opening email
- **Important email alerts:** Notify on Discord when important emails arrive
- **Send quick replies:** Reply to emails from Discord

### Drive
- **DB backup:** Nightly SQLite backup to Drive
- **File sharing:** Upload files from Discord to Drive
- **Screenshot archive:** Save browser screenshots to Drive

### Tasks / Keep
- **Todo sync:** Google Tasks ↔ Discord todo lists
- **Note taking:** Save Discord conversations to Google Keep

### Contacts
- **Birthday import:** Pull birthdays from Google Contacts
- **Contact lookup:** "What's X's email?"

---

## Setup Requirements

### Prerequisites

1. Install gogcli: `brew install gogcli`
2. Create Google Cloud project at console.cloud.google.com
3. Enable APIs: Sheets, Calendar, Gmail, Drive (as needed)
4. Create OAuth 2.0 Desktop credentials
5. Download client JSON
6. Auth: `gog auth add your@gmail.com --client-credentials /path/to/client.json`

### Config (config.json)

```json
{
  "google": {
    "account": "your@gmail.com",
    "sheetsBackup": {
      "enabled": true,
      "spreadsheetId": "abc123..."
    }
  }
}
```

### Choomfie Integration

`lib/google/auth.ts`:
```typescript
import { $ } from "bun";

export async function checkGogAuth(): Promise<{ authenticated: boolean; account?: string }> {
  try {
    const result = await $`gog auth list`.text();
    // Parse account list
    return { authenticated: true, account: parsedAccount };
  } catch {
    return { authenticated: false };
  }
}
```

---

## Implementation Order

1. **lib/google/auth.ts** — gogcli auth check + account helpers
2. **Birthday SQLite table + tools** — standalone, no Google dependency
3. **Birthday daily check** — setTimeout-based, notifications to owner DM
4. **lib/google/sheets.ts** — Sheets read/write via gogcli
5. **Memory → Sheets sync** — debounced export on change
6. **Birthday → Sheets sync** — mirror to "Birthdays" sheet
7. **/birthdays slash command** — embed with upcoming list
8. **Calendar integration** — birthday events (future)

Steps 2-3 work without Google auth. Steps 4+ need gogcli setup.

---

## Open Questions

- Should birthday check also ping the birthday person in a server channel? Or DM-only?
- Two-way Sheets sync worth the complexity? Or just one-way export?
- Should we import birthdays from Google Contacts on first setup?
