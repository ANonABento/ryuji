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

export interface ParseNaturalTimeOptions {
  now?: Date;
  timeZone?: string;
}

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

function getFormatter(
  timeZone: string,
  opts: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts });
}

export function normalizeTimeZone(timeZone: string): string | null {
  try {
    return getFormatter(timeZone, { hour: "numeric" }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  return normalizeTimeZone(timeZone) !== null;
}

export function formatTimeInTimeZone(date: Date, timeZone: string): string {
  return getFormatter(timeZone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const parts = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: string) => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ? parseInt(value, 10) : 0;
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function toUtcPartsValue(parts: TimeZoneParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function shiftLocalDate(parts: TimeZoneParts, days: number): TimeZoneParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    ...parts,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function zonedDateToUtc(parts: TimeZoneParts, timeZone: string): Date {
  let guess = toUtcPartsValue(parts);
  for (let i = 0; i < 3; i++) {
    const actual = getTimeZoneParts(new Date(guess), timeZone);
    const diff = toUtcPartsValue(parts) - toUtcPartsValue(actual);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function setHoursInTimeZone(
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
  nextDayIfPast: boolean
): Date {
  const localNow = getTimeZoneParts(now, timeZone);
  let target = zonedDateToUtc(
    {
      ...localNow,
      hour,
      minute,
      second: 0,
    },
    timeZone
  );

  if (nextDayIfPast && target <= now) {
    const tomorrow = shiftLocalDate(localNow, 1);
    target = zonedDateToUtc(
      {
        ...tomorrow,
        hour,
        minute,
        second: 0,
      },
      timeZone
    );
  }

  return target;
}

function parseClockTime(match: RegExpMatchArray): { hour: number; minute: number } {
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;

  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

/** Parse natural time expressions into a Date. Returns null if unparseable. */
export function parseNaturalTime(
  input: string,
  options: ParseNaturalTimeOptions = {}
): Date | null {
  const now = options.now ?? new Date();
  const lower = input.toLowerCase().trim();
  const timeZone = options.timeZone ? normalizeTimeZone(options.timeZone) : null;

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
    if (timeZone) {
      const tomorrow = shiftLocalDate(getTimeZoneParts(now, timeZone), 1);
      const { hour, minute } = match[1]
        ? parseClockTime([match[0], match[1], match[2] ?? "", match[3] ?? ""] as RegExpMatchArray)
        : { hour: 9, minute: 0 };

      return zonedDateToUtc(
        {
          ...tomorrow,
          hour,
          minute,
          second: 0,
        },
        timeZone
      );
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (match[1]) {
      const { hour, minute } = parseClockTime([
        match[0],
        match[1],
        match[2] ?? "",
        match[3] ?? "",
      ] as RegExpMatchArray);
      tomorrow.setHours(hour, minute, 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0); // Default to 9am
    }
    return tomorrow;
  }

  // "Xam/pm" or "X:YY am/pm" (today or tomorrow if past)
  match = lower.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match) {
    const { hour, minute } = parseClockTime(match);

    if (timeZone) {
      return setHoursInTimeZone(now, timeZone, hour, minute, true);
    }

    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
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
