/**
 * Shared time utilities — single source of truth for datetime formatting.
 *
 * SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (space separator, no Z).
 * All dates stored in the DB must match this format for comparisons to work.
 * JavaScript's toISOString() returns 'YYYY-MM-DDTHH:MM:SS.sssZ' which breaks
 * SQLite string comparisons (T > space in ASCII).
 */

/**
 * Convert any ISO 8601 datetime to SQLite-compatible format.
 * '2026-03-25T15:28:12Z'     → '2026-03-25 15:28:12'
 * '2026-03-25T15:28:12.000Z' → '2026-03-25 15:28:12'
 * '2026-03-25 15:28:12'      → '2026-03-25 15:28:12' (no-op)
 */
export function toSQLiteDatetime(iso: string): string {
  return iso.replace("T", " ").replace(/\.?\d*Z$/, "").trim();
}

/**
 * Get current UTC time in SQLite-compatible format.
 */
export function nowUTC(): string {
  return toSQLiteDatetime(new Date().toISOString());
}

/**
 * Convert a Date object to SQLite-compatible format.
 */
export function dateToSQLite(date: Date): string {
  return toSQLiteDatetime(date.toISOString());
}
