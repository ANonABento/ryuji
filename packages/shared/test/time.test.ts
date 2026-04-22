import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  fromSQLiteDatetime,
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

test("fromSQLiteDatetime treats SQLite timestamps as UTC", () => {
  expect(fromSQLiteDatetime("2026-03-25 15:28:12").toISOString()).toBe(
    "2026-03-25T15:28:12.000Z"
  );
});

test("relativeTime handles sub-minute past and future boundaries", () => {
  setSystemTime(new Date("2026-04-22T12:00:00.000Z"));

  expect(relativeTime("2026-04-22 12:00:30")).toBe("in <1 min");
  expect(relativeTime("2026-04-22 11:59:45")).toBe("just now");
});

test("parseNaturalTime handles 12am and tomorrow defaults", () => {
  setSystemTime(new Date("2026-04-22T20:00:00.000Z"));

  expect(parseNaturalTime("12am")?.toISOString()).toBe("2026-04-23T00:00:00.000Z");
  expect(parseNaturalTime("tomorrow")?.toISOString()).toBe("2026-04-23T09:00:00.000Z");
});
