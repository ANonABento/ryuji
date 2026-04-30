import { expect, test } from "bun:test";
import { buildStatsEmbed, getTopTools, trackToolCall } from "../lib/stats.ts";

function makeCtx() {
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
  } as any;
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
