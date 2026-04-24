import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import type { Reminder } from "../lib/memory.ts";
import { ReminderScheduler } from "../lib/reminders.ts";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MIN, dateToSQLite } from "../lib/time.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;

type StoredReminder = Reminder & { fired: number };

function createReminder(overrides: Partial<StoredReminder> = {}): StoredReminder {
  return {
    id: 1,
    userId: "user-1",
    chatId: "chat-1",
    message: "Pay rent",
    dueAt: dateToSQLite(new Date("2026-04-22T12:00:05.000Z")),
    createdAt: "2026-04-22 11:59:00",
    cron: null,
    nagInterval: null,
    category: null,
    ack: 0,
    lastNagAt: null,
    fired: 0,
    ...overrides,
  };
}

function toPublicReminder(reminder: StoredReminder): Reminder {
  return {
    id: reminder.id,
    userId: reminder.userId,
    chatId: reminder.chatId,
    message: reminder.message,
    dueAt: reminder.dueAt,
    createdAt: reminder.createdAt,
    cron: reminder.cron,
    nagInterval: reminder.nagInterval,
    category: reminder.category,
    ack: reminder.ack,
    lastNagAt: reminder.lastNagAt,
  };
}

function isNagDue(reminder: StoredReminder): boolean {
  if (!reminder.nagInterval || reminder.fired !== 1 || reminder.ack === 1) return false;
  if (!reminder.lastNagAt) return true;

  const nextNagAt = new Date(reminder.lastNagAt.replace(" ", "T") + "Z").getTime()
    + reminder.nagInterval * MS_PER_MIN;
  return nextNagAt <= Date.now();
}

function createHarness(reminders: StoredReminder[]) {
  const state = new Map(reminders.map((reminder) => [reminder.id, { ...reminder }]));
  let nextId = Math.max(0, ...reminders.map((reminder) => reminder.id)) + 1;

  const send = mock(async (payload: unknown) => payload);
  const fetch = mock(async () => ({
    isTextBased: () => true,
    send,
  }));

  const memory = {
    purgeOldReminders: () => 0,
    getActiveReminders: () =>
      Array.from(state.values())
        .filter((reminder) => reminder.fired === 0)
        .map(toPublicReminder),
    getNagReminders: () =>
      Array.from(state.values())
        .filter(isNagDue)
        .map(toPublicReminder),
    markReminderFired: (id: number) => {
      const reminder = state.get(id);
      if (!reminder) return;
      reminder.fired = 1;
      reminder.lastNagAt = dateToSQLite(new Date(Date.now()));
    },
    addReminder: (
      userId: string,
      chatId: string,
      message: string,
      dueAt: string,
      opts?: { cron?: string; nagInterval?: number; category?: string }
    ) => {
      const id = nextId++;
      state.set(
        id,
        createReminder({
          id,
          userId,
          chatId,
          message,
          dueAt,
          createdAt: dateToSQLite(new Date(Date.now())),
          cron: opts?.cron ?? null,
          nagInterval: opts?.nagInterval ?? null,
          category: opts?.category ?? null,
        })
      );
      return id;
    },
    getReminder: (id: number) => {
      const reminder = state.get(id);
      return reminder ? toPublicReminder(reminder) : null;
    },
    updateNagTime: (id: number) => {
      const reminder = state.get(id);
      if (!reminder) return;
      reminder.lastNagAt = dateToSQLite(new Date(Date.now()));
    },
    snoozeReminder: (id: number, newDueAt: string) => {
      const reminder = state.get(id);
      if (!reminder) return false;
      reminder.dueAt = newDueAt;
      reminder.fired = 0;
      reminder.ack = 0;
      reminder.lastNagAt = null;
      return true;
    },
  };

  const scheduler = new ReminderScheduler();
  const ctx = {
    discord: {
      channels: {
        fetch,
      },
    },
    memory,
  } as any;

  return { ctx, fetch, memory, scheduler, send, state };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ReminderScheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-04-22T12:00:00.000Z") });
  });

  afterEach(() => {
    jest.useRealTimers();
    mock.restore();
  });

  test("schedules the next cron occurrence after a reminder fires", async () => {
    const firstReminder = createReminder({
      cron: "hourly",
      category: "bills",
      dueAt: "2026-04-22 12:00:05",
    });
    const { ctx, scheduler, send, state } = createHarness([firstReminder]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        content: "**Reminder** [bills] for <@user-1>: Pay rent 🔁",
      })
    );
    expect(state.get(firstReminder.id)?.fired).toBe(1);

    const recurring = [...state.values()].find((reminder) => reminder.id !== firstReminder.id);
    expect(recurring).toBeDefined();
    expect(recurring?.dueAt).toBe("2026-04-22 13:00:05");
    expect(scheduler.activeTimerCount).toBe(1);
  });

  test("repeats nag reminders on schedule after the initial fire", async () => {
    const reminder = createReminder({
      dueAt: "2026-04-22 12:00:05",
      nagInterval: 1,
    });
    const { ctx, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(scheduler.activeNagCount).toBe(1);

    jest.advanceTimersByTime(MS_PER_MIN);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        content: "**Nag** for <@user-1>: Pay rent 🔔 *(click Done to acknowledge)*",
      })
    );
    expect(scheduler.activeNagCount).toBe(1);
  });

  test("resumes overdue nag reminders immediately on startup", async () => {
    const reminder = createReminder({
      fired: 1,
      nagInterval: 1,
      dueAt: "2026-04-22 11:59:00",
      lastNagAt: "2026-04-22 11:58:00",
    });
    const { ctx, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(0);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        content: "**Nag** for <@user-1>: Pay rent 🔔 *(click Done to acknowledge)*",
      })
    );
  });

  test("clears nag timers when a reminder is snoozed and reschedules the reminder", async () => {
    const reminder = createReminder({
      fired: 1,
      nagInterval: 1,
      dueAt: "2026-04-22 11:59:00",
      lastNagAt: "2026-04-22 12:00:00",
    });
    const { ctx, memory, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    (scheduler as any).scheduleNag(memory.getReminder(reminder.id));

    const newDueAt = "2026-04-22 12:00:30";
    expect(memory.snoozeReminder(reminder.id, newDueAt)).toBe(true);

    const updated = memory.getReminder(reminder.id);
    expect(updated?.dueAt).toBe(newDueAt);

    scheduler.scheduleReminder(updated!);
    expect(scheduler.activeNagCount).toBe(0);

    jest.advanceTimersByTime(29_000);
    await flushAsyncWork();
    expect(send).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1_000);
    await flushAsyncWork();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        content: "**Reminder** for <@user-1>: Pay rent 🔔",
      })
    );
  });

  test.each<[string, string]>([
    ["daily", "2026-04-23 12:00:05"],
    ["weekly", "2026-04-29 12:00:05"],
    ["monthly", "2026-05-22 12:00:05"],
    ["every 15m", "2026-04-22 12:15:05"],
    ["every 2h", "2026-04-22 14:00:05"],
    ["every 3d", "2026-04-25 12:00:05"],
  ])("schedules %s cron successor with expected dueAt", async (cron, expectedDueAt) => {
    const original = createReminder({ cron, dueAt: "2026-04-22 12:00:05" });
    const { ctx, scheduler, send, state } = createHarness([original]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    const successor = [...state.values()].find((r) => r.id !== original.id);
    expect(successor).toBeDefined();
    expect(successor?.dueAt).toBe(expectedDueAt);
    expect(successor?.cron).toBe(cron);
    expect(scheduler.activeTimerCount).toBe(1);
  });

  test("does not create a successor for an unknown cron pattern", async () => {
    const original = createReminder({ cron: "never", dueAt: "2026-04-22 12:00:05" });
    const { ctx, scheduler, send, state } = createHarness([original]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(state.get(original.id)?.fired).toBe(1);
    expect(state.size).toBe(1);
    expect(scheduler.activeTimerCount).toBe(0);
  });

  test("clearTimer cancels a pending reminder before it fires", async () => {
    const reminder = createReminder({ dueAt: "2026-04-22 18:00:00" });
    const { ctx, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    expect(scheduler.activeTimerCount).toBe(1);

    scheduler.clearTimer(reminder.id);
    expect(scheduler.activeTimerCount).toBe(0);

    jest.advanceTimersByTime(10 * MS_PER_HOUR);
    await flushAsyncWork();
    expect(send).toHaveBeenCalledTimes(0);
  });

  test("forwards cron + nagInterval + category onto the recurrence and starts a nag timer", async () => {
    const original = createReminder({
      cron: "hourly",
      nagInterval: 1,
      category: "bills",
      dueAt: "2026-04-22 12:00:05",
    });
    const { ctx, scheduler, send, state } = createHarness([original]);

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    const successor = [...state.values()].find((r) => r.id !== original.id);
    expect(successor).toBeDefined();
    expect(successor?.cron).toBe("hourly");
    expect(successor?.nagInterval).toBe(1);
    expect(successor?.category).toBe("bills");
    expect(successor?.dueAt).toBe("2026-04-22 13:00:05");
    expect(scheduler.activeNagCount).toBe(1);

    jest.advanceTimersByTime(MS_PER_MIN);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("**Nag** [bills]"),
      })
    );
    expect(scheduler.activeNagCount).toBe(1);
  });

  test("still marks a reminder fired when the channel fetch throws", async () => {
    const reminder = createReminder({ dueAt: "2026-04-22 12:00:05" });
    const { ctx, fetch, scheduler, send, state } = createHarness([reminder]);
    fetch.mockImplementation(async () => {
      throw new Error("channel not accessible");
    });

    scheduler.init(ctx);
    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(0);
    expect(state.get(reminder.id)?.fired).toBe(1);
  });

  test("re-arms long-horizon timers past MAX_TIMEOUT_MS", async () => {
    // 30 days out — well past the 24.8-day setTimeout ceiling
    const reminder = createReminder({ dueAt: "2026-05-22 12:00:00" });
    const { ctx, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    expect(scheduler.activeTimerCount).toBe(1);

    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    await flushAsyncWork();
    expect(send).toHaveBeenCalledTimes(0);
    expect(scheduler.activeTimerCount).toBe(1);

    const totalSpanMs = 30 * MS_PER_DAY;
    const remainingMs = totalSpanMs - MAX_TIMEOUT_MS;
    jest.advanceTimersByTime(remainingMs);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(scheduler.activeTimerCount).toBe(0);
  });

  test("destroy clears all fire and nag timers", async () => {
    const nagging = createReminder({
      fired: 1,
      nagInterval: 1,
      dueAt: "2026-04-22 11:59:00",
      lastNagAt: "2026-04-22 11:58:00",
    });
    const pending = createReminder({ id: 2, dueAt: "2026-04-22 18:00:00" });
    const { ctx, scheduler, send } = createHarness([nagging, pending]);

    scheduler.init(ctx);
    // Let any overdue nag re-fire immediately so we can snapshot the baseline
    jest.advanceTimersByTime(0);
    await flushAsyncWork();
    const baselineSends = send.mock.calls.length;

    scheduler.destroy();
    expect(scheduler.activeTimerCount).toBe(0);
    expect(scheduler.activeNagCount).toBe(0);

    jest.advanceTimersByTime(24 * MS_PER_HOUR);
    await flushAsyncWork();
    expect(send).toHaveBeenCalledTimes(baselineSends);
  });

  test("scheduleReminder called twice for the same ID replaces the existing timer", async () => {
    const reminder = createReminder({ dueAt: "2026-04-22 12:00:05" });
    const { ctx, scheduler, send } = createHarness([reminder]);

    scheduler.init(ctx);
    expect(scheduler.activeTimerCount).toBe(1);

    scheduler.scheduleReminder(reminder);
    expect(scheduler.activeTimerCount).toBe(1);

    jest.advanceTimersByTime(5_000);
    await flushAsyncWork();

    expect(send).toHaveBeenCalledTimes(1);
    expect(scheduler.activeTimerCount).toBe(0);
  });
});
