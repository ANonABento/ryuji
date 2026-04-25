/**
 * Shared time utilities — constants, formatting, parsing.
 *
 * SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (space separator, no Z).
 * All dates stored in the DB must match this format for comparisons to work.
 * JavaScript's toISOString() returns 'YYYY-MM-DDTHH:MM:SS.sssZ' which breaks
 * SQLite string comparisons (T > space in ASCII).
 */

// --- Time constants (ms) ---

export const MS_PER_MIN = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

// --- SQLite formatting ---

/**
 * Convert any ISO 8601 datetime to SQLite-compatible format.
 * '2026-03-25T15:28:12Z'     → '2026-03-25 15:28:12'
 * '2026-03-25T15:28:12.000Z' → '2026-03-25 15:28:12'
 * '2026-03-25 15:28:12'      → '2026-03-25 15:28:12' (no-op)
 */
export function toSQLiteDatetime(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "").trim();
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

/**
 * Parse a SQLite datetime string back to a Date (always UTC).
 * SQLite stores 'YYYY-MM-DD HH:MM:SS' without timezone — this is UTC.
 * new Date() would interpret it as local time, so we append 'Z'.
 */
export function fromSQLiteDatetime(sqliteDate: string): Date {
  // If already has T or Z, parse as-is; otherwise treat as UTC
  if (sqliteDate.includes("T") || sqliteDate.includes("Z")) {
    return new Date(sqliteDate);
  }
  return new Date(sqliteDate.replace(" ", "T") + "Z");
}

// --- Duration formatting ---

/** Format milliseconds as human-readable duration (e.g. "2d 3h", "45m", "12s") */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Format relative time from now (e.g. "in 5m", "2h ago") */
export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const target = fromSQLiteDatetime(isoDate).getTime();
  const diffMs = target - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;

  if (abs < MS_PER_MIN) return past ? "just now" : "in <1 min";
  if (abs < MS_PER_HOUR) {
    const mins = Math.floor(abs / MS_PER_MIN);
    return past ? `${mins}m ago` : `in ${mins}m`;
  }
  if (abs < MS_PER_DAY) {
    const hrs = Math.floor(abs / MS_PER_HOUR);
    return past ? `${hrs}h ago` : `in ${hrs}h`;
  }
  const days = Math.floor(abs / MS_PER_DAY);
  return past ? `${days}d ago` : `in ${days}d`;
}

// --- Natural time parsing ---

/** Parse natural time expressions into a Date. Returns null if unparseable. */
export interface ParseNaturalTimeOptions {
  now?: Date;
  timeZone?: string | null;
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Check if a string is a valid IANA timezone name. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!Intl.supportedValuesOf("timeZone").includes(timeZone)) return false;
  try {
    getFormatter(timeZone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Trim and validate an optional IANA timezone name. */
export function normalizeTimeZone(timeZone?: string | null): string | null {
  const normalized = timeZone?.trim();
  if (!normalized) return null;
  return isValidTimeZone(normalized) ? normalized : null;
}

/** Get local calendar/time parts for a UTC instant in a timezone. */
export function getZonedParts(date: Date, timeZone: string): ZonedDateTimeParts | null {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized) return null;

  const values: Record<string, number> = {};
  for (const part of getFormatter(normalized).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = parseInt(part.value, 10);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function partsToUtcMs(parts: ZonedDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
}

function sameParts(a: ZonedDateTimeParts, b: ZonedDateTimeParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * Convert local wall-clock parts in an IANA timezone to a UTC Date.
 * Ambiguous fall-back times resolve to the earliest matching instant; nonexistent
 * spring-forward times return null.
 */
export function zonedTimeToUtc(
  parts: ZonedDateTimeParts,
  timeZone: string
): Date | null {
  const normalized = normalizeTimeZone(timeZone);
  if (!normalized) return null;

  let guessMs = partsToUtcMs(parts);
  for (let i = 0; i < 5; i++) {
    const actual = getZonedParts(new Date(guessMs), normalized);
    if (!actual) return null;
    if (sameParts(actual, parts)) return new Date(guessMs);
    guessMs += partsToUtcMs(parts) - partsToUtcMs(actual);
  }

  const finalParts = getZonedParts(new Date(guessMs), normalized);
  return finalParts && sameParts(finalParts, parts) ? new Date(guessMs) : null;
}

function addLocalDays(parts: ZonedDateTimeParts, days: number): ZonedDateTimeParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addLocalMonths(parts: ZonedDateTimeParts, months: number): ZonedDateTimeParts {
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  return {
    ...parts,
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  };
}

/** Add calendar days in a timezone while preserving local wall-clock time. */
export function addZonedCalendarDays(date: Date, days: number, timeZone: string): Date | null {
  const parts = getZonedParts(date, timeZone);
  if (!parts) return null;
  return zonedTimeToUtc(addLocalDays(parts, days), timeZone);
}

/** Add calendar months in a timezone while preserving local wall-clock time. */
export function addZonedCalendarMonths(
  date: Date,
  months: number,
  timeZone: string
): Date | null {
  const parts = getZonedParts(date, timeZone);
  if (!parts) return null;
  return zonedTimeToUtc(addLocalMonths(parts, months), timeZone);
}

function parseLocalTime(
  hoursRaw: string,
  minutesRaw: string | undefined,
  ampm: string | undefined
): { hour: number; minute: number } | null {
  let hour = parseInt(hoursRaw, 10);
  const minute = minutesRaw ? parseInt(minutesRaw, 10) : 0;
  if (minute > 59) return null;

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

function makeZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date | null {
  return zonedTimeToUtc({ year, month, day, hour, minute, second: 0 }, timeZone);
}

/** Parse natural time expressions into a Date. Returns null if unparseable. */
export function parseNaturalTime(
  input: string,
  opts: ParseNaturalTimeOptions = {}
): Date | null {
  const now = opts.now ?? new Date();
  const timeZoneInput = opts.timeZone?.trim() ?? "";
  const normalizedTimeZone = timeZoneInput ? normalizeTimeZone(timeZoneInput) : null;
  if (timeZoneInput && !normalizedTimeZone) return null;
  const timeZone = normalizedTimeZone ?? "UTC";
  const lower = input.toLowerCase().trim();

  if (!lower) return null;

  // Exact ISO instants with UTC/offset are already absolute.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:\d{2})$/i.test(input.trim())) {
    const exact = new Date(input.trim());
    return Number.isNaN(exact.getTime()) ? null : exact;
  }

  // Shorthand: "30s", "5m", "2h", "3d" (no spaces, no "in")
  let match = lower.match(/^(\d+)\s*(s|sec|secs|seconds?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * 1000);
  }
  match = lower.match(/^(\d+)\s*(m|min|mins|minutes?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_MIN);
  }
  match = lower.match(/^(\d+)\s*(h|hr|hrs|hours?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_HOUR);
  }
  match = lower.match(/^(\d+)\s*(d|days?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_DAY);
  }

  // "in X seconds/sec/s"
  match = lower.match(/^in\s+(\d+)\s*(s|sec|secs|seconds?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * 1000);
  }

  // "in X min/minutes/m"
  match = lower.match(/^in\s+(\d+)\s*(m|min|mins|minutes?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_MIN);
  }

  // "in X hours/h/hr"
  match = lower.match(/^in\s+(\d+)\s*(h|hr|hrs|hours?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_HOUR);
  }

  // "in X days/d"
  match = lower.match(/^in\s+(\d+)\s*(d|days?)$/);
  if (match) {
    return new Date(now.getTime() + parseInt(match[1]) * MS_PER_DAY);
  }

  // "Xh Ym" or "X hours Y minutes" (with or without "in")
  match = lower.match(/^(?:in\s+)?(\d+)\s*h(?:ours?)?\s+(\d+)\s*m(?:in(?:ute)?s?)?$/);
  if (match) {
    return new Date(
      now.getTime() +
        parseInt(match[1]) * MS_PER_HOUR +
        parseInt(match[2]) * MS_PER_MIN
    );
  }

  // "tomorrow" or "tomorrow at Xam/pm"
  match = lower.match(/^tomorrow(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (match) {
    const nowParts = getZonedParts(now, timeZone);
    if (!nowParts) return null;
    const localTime = match[1]
      ? parseLocalTime(match[1], match[2], match[3])
      : { hour: 9, minute: 0 };
    if (!localTime) return null;
    const tomorrowParts = addLocalDays(nowParts, 1);
    return makeZonedDate(
      tomorrowParts.year,
      tomorrowParts.month,
      tomorrowParts.day,
      localTime.hour,
      localTime.minute,
      timeZone
    );
  }

  // "Xam/pm" or "X:YY am/pm" (today or tomorrow if past)
  match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match) {
    const nowParts = getZonedParts(now, timeZone);
    const localTime = parseLocalTime(match[1], match[2], match[3]);
    if (!nowParts || !localTime) return null;
    let target = makeZonedDate(
      nowParts.year,
      nowParts.month,
      nowParts.day,
      localTime.hour,
      localTime.minute,
      timeZone
    );
    if (target && target <= now) {
      const tomorrowParts = addLocalDays(nowParts, 1);
      target = makeZonedDate(
        tomorrowParts.year,
        tomorrowParts.month,
        tomorrowParts.day,
        localTime.hour,
        localTime.minute,
        timeZone
      );
    }
    return target;
  }

  // "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm" without timezone.
  match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (match) {
    const parts = {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      day: parseInt(match[3], 10),
      hour: parseInt(match[4], 10),
      minute: parseInt(match[5], 10),
      second: match[6] ? parseInt(match[6], 10) : 0,
    };
    if (
      parts.month < 1 ||
      parts.month > 12 ||
      parts.day < 1 ||
      parts.day > 31 ||
      parts.hour > 23 ||
      parts.minute > 59 ||
      parts.second > 59
    ) {
      return null;
    }
    return zonedTimeToUtc(parts, timeZone);
  }

  return null;
}

// --- Cron validation ---

const VALID_CRON = ["hourly", "daily", "weekly", "monthly"];
const CRON_PATTERN = /^every\s+\d+\s*(m|min|h|hr|d|day)s?$/i;

/** Check if a cron pattern string is valid */
export function isValidCron(pattern: string): boolean {
  return VALID_CRON.includes(pattern) || CRON_PATTERN.test(pattern);
}
