import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  dateToSQLite,
  formatDuration,
  fromSQLiteDatetime,
  isValidCron,
  nowUTC,
  parseNaturalTime,
  relativeTime,
  toSQLiteDatetime,
} from "../time.ts";

afterEach(() => {
  setSystemTime();
});

test("toSQLiteDatetime normalizes ISO timestamps with timezone offsets", () => {
  expect(toSQLiteDatetime("2026-03-25T15:28:12+02:00")).toBe("2026-03-25 13:28:12");
  expect(toSQLiteDatetime("2026-03-25T15:28:12.250-03:30")).toBe("2026-03-25 18:58:12");
});

test("toSQLiteDatetime is idempotent on already-SQLite strings", () => {
  expect(toSQLiteDatetime("2026-03-25 15:28:12")).toBe("2026-03-25 15:28:12");
  expect(toSQLiteDatetime("  2026-03-25 15:28:12  ")).toBe("2026-03-25 15:28:12");
});

test("fromSQLiteDatetime treats SQLite timestamps as UTC", () => {
  expect(fromSQLiteDatetime("2026-03-25 15:28:12").toISOString()).toBe(
    "2026-03-25T15:28:12.000Z"
  );
});

test("fromSQLiteDatetime passes through ISO strings with T or Z unchanged", () => {
  expect(fromSQLiteDatetime("2026-03-25T15:28:12Z").toISOString()).toBe(
    "2026-03-25T15:28:12.000Z"
  );
  expect(fromSQLiteDatetime("2026-03-25T15:28:12.500Z").toISOString()).toBe(
    "2026-03-25T15:28:12.500Z"
  );
});

test("dateToSQLite formats a Date into SQLite UTC string", () => {
  expect(dateToSQLite(new Date("2026-04-22T12:00:05.000Z"))).toBe("2026-04-22 12:00:05");
});

test("nowUTC matches dateToSQLite(new Date()) under a pinned clock", () => {
  setSystemTime(new Date("2026-04-22T12:00:05.000Z"));
  expect(nowUTC()).toBe("2026-04-22 12:00:05");
  expect(nowUTC()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("relativeTime handles sub-minute past and future boundaries", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(relativeTime("2026-04-22 12:00:30")).toBe("in <1 min");
  expect(relativeTime("2026-04-22 11:59:45")).toBe("just now");
});

test("relativeTime formats minute, hour, and day scales in both directions", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(relativeTime("2026-04-22 12:30:00")).toBe("in 30m");
  expect(relativeTime("2026-04-22 11:30:00")).toBe("30m ago");
  expect(relativeTime("2026-04-22 15:00:00")).toBe("in 3h");
  expect(relativeTime("2026-04-22 09:00:00")).toBe("3h ago");
  expect(relativeTime("2026-04-25 12:00:00")).toBe("in 3d");
  expect(relativeTime("2026-04-19 12:00:00")).toBe("3d ago");
});

test("formatDuration covers second, minute, hour, and day transitions", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(59_000)).toBe("59s");
  expect(formatDuration(60_000)).toBe("1m");
  expect(formatDuration(59 * 60_000)).toBe("59m");
  expect(formatDuration(3_600_000)).toBe("1h 0m");
  expect(formatDuration(3_600_000 + 30 * 60_000)).toBe("1h 30m");
  expect(formatDuration(90_000_000)).toBe("1d 1h");
});

test("isValidCron accepts documented patterns and rejects unknown", () => {
  for (const pat of [
    "hourly",
    "daily",
    "weekly",
    "monthly",
    "every 5m",
    "every 2h",
    "every 3d",
    "every 15 min",
    "every 1 day",
  ]) {
    expect(isValidCron(pat)).toBe(true);
  }
  for (const pat of ["", "yearly", "every 5 weeks", "every X minutes", "tomorrow"]) {
    expect(isValidCron(pat)).toBe(false);
  }
});

test("parseNaturalTime handles 12am and tomorrow defaults", () => {
  setSystemTime(new Date("2026-04-22T20:00:00.000Z"));

  expect(parseNaturalTime("12am")?.toISOString()).toBe("2026-04-23T00:00:00.000Z");
  expect(parseNaturalTime("tomorrow")?.toISOString()).toBe("2026-04-23T09:00:00.000Z");
});

test("parseNaturalTime handles shorthand durations", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(parseNaturalTime("30s")?.toISOString()).toBe("2026-04-22T12:00:30.000Z");
  expect(parseNaturalTime("5m")?.toISOString()).toBe("2026-04-22T12:05:00.000Z");
  expect(parseNaturalTime("2h")?.toISOString()).toBe("2026-04-22T14:00:00.000Z");
  expect(parseNaturalTime("3d")?.toISOString()).toBe("2026-04-25T12:00:00.000Z");
});

test("parseNaturalTime handles 'in X unit' phrases", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(parseNaturalTime("in 30 seconds")?.toISOString()).toBe("2026-04-22T12:00:30.000Z");
  expect(parseNaturalTime("in 5 minutes")?.toISOString()).toBe("2026-04-22T12:05:00.000Z");
  expect(parseNaturalTime("in 2 hours")?.toISOString()).toBe("2026-04-22T14:00:00.000Z");
  expect(parseNaturalTime("in 3 days")?.toISOString()).toBe("2026-04-25T12:00:00.000Z");
});

test("parseNaturalTime handles compound hours-minutes with and without 'in'", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(parseNaturalTime("2h 30m")?.toISOString()).toBe("2026-04-22T14:30:00.000Z");
  expect(parseNaturalTime("in 2h 30m")?.toISOString()).toBe("2026-04-22T14:30:00.000Z");
  expect(parseNaturalTime("2 hours 30 minutes")?.toISOString()).toBe("2026-04-22T14:30:00.000Z");
});

test("parseNaturalTime resolves Xpm to today when still upcoming", () => {
  setSystemTime(new Date("2026-04-22T10:00:00.000Z"));

  expect(parseNaturalTime("3pm")?.toISOString()).toBe("2026-04-22T15:00:00.000Z");
  expect(parseNaturalTime("3:45pm")?.toISOString()).toBe("2026-04-22T15:45:00.000Z");
});

test("parseNaturalTime rolls Xpm to tomorrow when already past", () => {
  setSystemTime(new Date("2026-04-22T21:00:00.000Z"));

  expect(parseNaturalTime("3pm")?.toISOString()).toBe("2026-04-23T15:00:00.000Z");
});

test("parseNaturalTime 'tomorrow at 3pm' returns next day 15:00", () => {
  setSystemTime(new Date("2026-04-22T10:00:00.000Z"));

  expect(parseNaturalTime("tomorrow at 3pm")?.toISOString()).toBe("2026-04-23T15:00:00.000Z");
});

test("parseNaturalTime distinguishes 12pm noon from 12am midnight", () => {
  setSystemTime(new Date("2026-04-22T05:00:00.000Z"));

  expect(parseNaturalTime("12pm")?.toISOString()).toBe("2026-04-22T12:00:00.000Z");
  // 12am is earlier than 5am, so rollover to next day
  expect(parseNaturalTime("12am")?.toISOString()).toBe("2026-04-23T00:00:00.000Z");
});

test("parseNaturalTime returns null for unparseable input", () => {
  expect(parseNaturalTime("next fortnight")).toBeNull();
  expect(parseNaturalTime("")).toBeNull();
  expect(parseNaturalTime("somewhen")).toBeNull();
});
