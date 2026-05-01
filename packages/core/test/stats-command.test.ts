import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { buildStatsEmbed, getTokenUsageToday, getTopTools, trackToolCall } from "../lib/stats.ts";
import type { AppContext } from "../lib/types.ts";

type StatsReply = {
  flags?: MessageFlags;
  embeds?: unknown[];
};

function makeCtx(): AppContext {
  return {
    DATA_DIR: "/tmp/choomfie-stats-test-missing",
    discord: { user: null },
    startedAt: Date.now() - 65_000,
    messageStats: {
      received: 7,
      sent: 3,
      byUser: new Map(),
    },
    config: {
      getActivePersona() {
        return { name: "Test Persona", personality: "test" };
      },
      getActivePersonaKey() {
        return "test";
      },
    },
    plugins: [
      { name: "voice", tools: [{}, {}] },
      { name: "browser", tools: [{}] },
    ],
  } as unknown as AppContext;
}

test("tracks top tools by count then name", () => {
  const ctx = makeCtx();
  trackToolCall(ctx, "reply");
  trackToolCall(ctx, "search_memory");
  trackToolCall(ctx, "reply");
  trackToolCall(ctx, "create_thread");
  trackToolCall(ctx, "create_thread");

  expect(getTopTools(ctx)).toEqual([
    { name: "create_thread", count: 2 },
    { name: "reply", count: 2 },
    { name: "search_memory", count: 1 },
  ]);
});

test("buildStatsEmbed includes required stats fields", async () => {
  const ctx = makeCtx();
  trackToolCall(ctx, "reply");

  const embed = (await buildStatsEmbed(ctx)).toJSON();
  const fields = embed.fields ?? [];

  expect(fields.find((field) => field.name === "Messages Handled")?.value).toContain("10 total");
  expect(fields.find((field) => field.name === "Current Persona")?.value).toContain("Test Persona");
  expect(fields.find((field) => field.name === "Token Usage Today")?.value).toContain("0 input tokens");
  expect(fields.find((field) => field.name === "Active Plugins")?.value).toContain("voice (2 tools)");
  expect(fields.find((field) => field.name === "Top Tools")?.value).toContain("`reply`");
});

test("/stats command replies ephemerally with the stats embed", async () => {
  const { commands } = await import("../lib/interactions.ts");
  const stats = commands.get("stats");
  let reply: StatsReply | undefined;

  await stats?.handler(
    {
      reply(payload: StatsReply) {
        reply = payload;
        return Promise.resolve();
      },
    } as unknown as ChatInputCommandInteraction,
    makeCtx()
  );

  expect(stats?.data.name).toBe("stats");
  expect(reply?.flags).toBe(MessageFlags.Ephemeral);
  expect(reply?.embeds).toHaveLength(1);
});

test("reads token usage only for the current day", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-stats-"));
  await mkdir(join(dir, "meta"));

  const ctx = { DATA_DIR: dir };
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(
    join(dir, "meta", "daemon-state.json"),
    JSON.stringify({
      pid: process.pid,
      tokenUsageToday: { date: today, inputTokens: 1234 },
    })
  );
  expect(await getTokenUsageToday(ctx)).toBe(1234);

  await writeFile(
    join(dir, "meta", "daemon-state.json"),
    JSON.stringify({
      pid: process.pid,
      tokenUsageToday: { date: "2000-01-01", inputTokens: 9999 },
    })
  );
  expect(await getTokenUsageToday(ctx)).toBe(0);
});

test("reads same-day token usage even with stale pid metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-stats-"));
  await mkdir(join(dir, "meta"));

  const ctx = { DATA_DIR: dir };
  const today = new Date().toISOString().slice(0, 10);

  await writeFile(
    join(dir, "meta", "daemon-state.json"),
    JSON.stringify({
      pid: 123456789,
      tokenUsageToday: { date: today, inputTokens: 2048 },
    })
  );

  expect(await getTokenUsageToday(ctx)).toBe(2048);
});

test("guards against malformed token counts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-stats-"));
  await mkdir(join(dir, "meta"));

  const ctx = { DATA_DIR: dir };
  const today = new Date().toISOString().slice(0, 10);

  await writeFile(
    join(dir, "meta", "daemon-state.json"),
    JSON.stringify({
      tokenUsageToday: { date: today, inputTokens: "not-a-number" },
    })
  );

  expect(await getTokenUsageToday(ctx)).toBe(0);
});
