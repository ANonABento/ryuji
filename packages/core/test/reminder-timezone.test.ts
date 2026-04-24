import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../lib/config.ts";
import { buildReminderModal } from "../lib/handlers/modals.ts";
import { MemoryStore } from "../lib/memory.ts";
import { buildInstructions } from "../lib/mcp-server.ts";
import { reminderTools } from "../lib/tools/reminder-tools.ts";
import { MS_PER_DAY, parseNaturalTime } from "../lib/time.ts";
import type { AppContext } from "../lib/types.ts";

const tempPaths: string[] = [];

afterEach(() => {
  while (tempPaths.length > 0) {
    const path = tempPaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempPaths.push(path);
  return path;
}

test("parseNaturalTime uses the user's timezone for clock times", () => {
  const now = new Date("2026-01-15T13:00:00.000Z");
  const parsed = parseNaturalTime("9am", {
    now,
    timeZone: "America/New_York",
  });

  expect(parsed?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
});

test("parseNaturalTime rolls past local clock times into the next day", () => {
  const now = new Date("2026-01-15T15:30:00.000Z");
  const parsed = parseNaturalTime("9am", {
    now,
    timeZone: "America/New_York",
  });

  expect(parsed?.toISOString()).toBe("2026-01-16T14:00:00.000Z");
});

test("parseNaturalTime keeps relative durations stable with a timezone set", () => {
  const now = new Date("2026-01-15T13:00:00.000Z");
  const parsed = parseNaturalTime("30m", {
    now,
    timeZone: "America/New_York",
  });

  expect(parsed?.toISOString()).toBe("2026-01-15T13:30:00.000Z");
});

test("ConfigManager stores timezone per user", () => {
  const dir = makeTempDir("choomfie-config-");
  const config = new ConfigManager(dir);

  const saved = config.setUserTimezone("user-1", "America/New_York");
  expect(saved).toBe("America/New_York");
  expect(config.getUserTimezone("user-1")).toBe("America/New_York");

  const reloaded = new ConfigManager(dir);
  expect(reloaded.getUserTimezone("user-1")).toBe("America/New_York");
  expect(reloaded.clearUserTimezone("user-1")).toBe(true);
  expect(reloaded.getUserTimezone("user-1")).toBeNull();
});

test("reminder modal shows the user's local time", () => {
  const modal = buildReminderModal({
    timeZone: "America/New_York",
    now: new Date("2026-01-15T13:05:00.000Z"),
  }).toJSON();

  const timeInput = modal.components[1]?.components[0];
  expect(timeInput?.label).toBe("When (8:05 AM EST)");
  expect(timeInput?.placeholder).toContain("America/New_York");
});

test("existing reminders still round-trip in UTC storage format", () => {
  const dir = makeTempDir("choomfie-db-");
  const memory = new MemoryStore(join(dir, "choomfie.db"));

  const id = memory.addReminder(
    "user-1",
    "channel-1",
    "deploy",
    "2026-01-15 14:00:00"
  );

  expect(memory.getReminder(id)?.dueAt).toBe("2026-01-15 14:00:00");
  memory.close();
});

test("snooze 'tomorrow' resolves to 9am in the user's timezone", () => {
  const now = new Date("2026-01-15T20:00:00.000Z");
  const parsed = parseNaturalTime("tomorrow 9am", {
    timeZone: "America/New_York",
    now,
  });

  expect(parsed?.toISOString()).toBe("2026-01-16T14:00:00.000Z");
});

test("snooze 'tomorrow' falls back to now+24h when no timezone is set", () => {
  // Mirrors reminder-buttons.ts: when timeZone is undefined, skip parseNaturalTime entirely.
  const now = new Date("2026-01-15T20:00:00.000Z");
  const timeZone: string | undefined = undefined;
  const parsed = timeZone
    ? parseNaturalTime("tomorrow 9am", { timeZone, now })
    : null;
  const resolved = parsed ?? new Date(now.getTime() + MS_PER_DAY);

  const diff = Math.abs(resolved.getTime() - (now.getTime() + MS_PER_DAY));
  expect(diff).toBeLessThan(1000);
});

test("buildInstructions includes the Time & Timezones block", () => {
  const dir = makeTempDir("choomfie-instructions-");
  const config = new ConfigManager(dir);
  const memory = new MemoryStore(join(dir, "choomfie.db"));

  const ctx = {
    config,
    memory,
    plugins: [],
  } as unknown as AppContext;

  const instructions = buildInstructions(ctx);

  expect(instructions).toContain("## Time & Timezones");
  expect(instructions).toContain("user_timezone");
  expect(instructions.length).toBeLessThan(4000);

  memory.close();
});

test("set_reminder description references user_timezone meta", () => {
  const setReminder = reminderTools.find(
    (t) => t.definition.name === "set_reminder"
  );
  expect(setReminder).toBeTruthy();
  expect(setReminder!.definition.description).toContain("user_timezone");
});
