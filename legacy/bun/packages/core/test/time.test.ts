import { expect, test } from "bun:test";
import {
  dateToSQLite,
  isValidTimeZone,
  parseNaturalTime,
} from "../lib/time.ts";

test("isValidTimeZone accepts IANA zones and rejects invalid names", () => {
  expect(isValidTimeZone("UTC")).toBe(true);
  expect(isValidTimeZone("America/New_York")).toBe(true);
  expect(isValidTimeZone("Europe/London")).toBe(true);
  expect(isValidTimeZone("Mars/Base")).toBe(false);
  expect(isValidTimeZone("EST")).toBe(false);
});

test("relative expressions are independent of timezone", () => {
  const now = new Date("2026-04-25T12:00:00Z");

  expect(dateToSQLite(parseNaturalTime("in 30 min", { now })!)).toBe(
    "2026-04-25 12:30:00"
  );
  expect(
    dateToSQLite(
      parseNaturalTime("in 30 min", { now, timeZone: "America/New_York" })!
    )
  ).toBe("2026-04-25 12:30:00");
});

test("ISO UTC and offset instants parse as exact instants", () => {
  expect(dateToSQLite(parseNaturalTime("2026-04-25T14:30:00Z")!)).toBe(
    "2026-04-25 14:30:00"
  );
  expect(
    dateToSQLite(parseNaturalTime("2026-04-25T09:30:00-05:00")!)
  ).toBe("2026-04-25 14:30:00");
});

test("local wall-clock datetime uses supplied timezone", () => {
  const parsed = parseNaturalTime("2026-04-25 09:00", {
    timeZone: "America/New_York",
  });

  expect(dateToSQLite(parsed!)).toBe("2026-04-25 13:00:00");
});

test("tomorrow at 9am uses supplied timezone instead of process timezone", () => {
  const now = new Date("2026-04-25T12:00:00Z");
  const parsed = parseNaturalTime("tomorrow at 9am", {
    now,
    timeZone: "America/New_York",
  });

  expect(dateToSQLite(parsed!)).toBe("2026-04-26 13:00:00");
});

test("wall-clock expressions without timezone use UTC fallback", () => {
  const now = new Date("2026-04-25T12:00:00Z");

  expect(dateToSQLite(parseNaturalTime("tomorrow at 9am", { now })!)).toBe(
    "2026-04-26 09:00:00"
  );
  expect(dateToSQLite(parseNaturalTime("2026-04-25 09:00")!)).toBe(
    "2026-04-25 09:00:00"
  );
});

test("nonexistent DST local times are rejected", () => {
  expect(
    parseNaturalTime("2026-03-08 02:30", {
      timeZone: "America/New_York",
    })
  ).toBeNull();
});
