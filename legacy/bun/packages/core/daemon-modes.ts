import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import type { HandoffEntry, MetaState } from "./daemon-types.ts";

type DaemonModeOptions = {
  acquirePid: () => Promise<void>;
  cleanup: (state: MetaState) => Promise<void>;
  createState: () => MetaState;
  cycleSession: (state: MetaState, tokenCount?: number) => Promise<void>;
  loadHandoffs: () => Promise<HandoffEntry[]>;
  log: (msg: string) => void;
  setupShutdown: (state: MetaState) => void;
  startSession: (state: MetaState, handoffSummary?: string) => Promise<void>;
  waitForResult: (state: MetaState, timeoutMs: number) => Promise<SDKResultSuccess>;
};

export async function runCycleTest(opts: DaemonModeOptions): Promise<void> {
  opts.log("=== TEST: Session Cycling ===");

  await opts.acquirePid();
  const state = opts.createState();

  opts.setupShutdown(state);
  await opts.startSession(state);

  opts.log("Sending test message...");
  state.pushMessage?.({
    type: "user",
    message: {
      role: "user",
      content: "Say hello and tell me your current persona name. Keep it brief.",
    },
    parent_tool_use_id: null,
  });

  opts.log("Waiting for response...");
  try {
    const result = await opts.waitForResult(state, 30_000);
    opts.log(`Got response: ${result.result?.slice(0, 200)}`);
  } catch (err: any) {
    opts.log(`Response wait failed: ${err.message}`);
  }

  opts.log("Waiting 10s before triggering cycle...");
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  opts.log("Triggering manual cycle...");
  await opts.cycleSession(state, state.totalInputTokens);

  if (state.state !== "ACTIVE") {
    opts.log("FAIL: Session did not reach ACTIVE state after cycle");
    await opts.cleanup(state);
    process.exit(1);
  }

  const handoffs = await opts.loadHandoffs();
  const lastHandoff = handoffs[handoffs.length - 1];
  if (!lastHandoff) {
    opts.log("FAIL: No handoff entry found");
    await opts.cleanup(state);
    process.exit(1);
  }

  opts.log(`Handoff summary (first 200 chars): ${lastHandoff.summary.slice(0, 200)}`);

  if (lastHandoff.summary.startsWith("Session cycled at")) {
    opts.log("WARN: Got generic fallback summary — handoff capture may not have worked");
  } else {
    opts.log("OK: Got meaningful handoff summary");
  }

  opts.log("Sending post-cycle message...");
  state.pushMessage?.({
    type: "user",
    message: {
      role: "user",
      content:
        "Do you have any handoff context from a previous session? Just say yes or no briefly.",
    },
    parent_tool_use_id: null,
  });

  try {
    const result = await opts.waitForResult(state, 30_000);
    opts.log(`Post-cycle response: ${result.result?.slice(0, 200)}`);
  } catch (err: any) {
    opts.log(`Post-cycle response wait failed: ${err.message}`);
  }

  opts.log("=== TEST COMPLETE: Session Cycling ===");
  await opts.cleanup(state);
  process.exit(0);
}

export async function runLatencyBenchmark(opts: DaemonModeOptions): Promise<void> {
  opts.log("=== BENCHMARK: Latency Measurement ===");

  await opts.acquirePid();
  const state = opts.createState();
  opts.setupShutdown(state);

  await opts.startSession(state);

  const numMessages = 5;
  const latencies: number[] = [];

  for (let i = 0; i < numMessages; i++) {
    opts.log(`Message ${i + 1}/${numMessages}...`);
    const start = performance.now();

    state.pushMessage?.({
      type: "user",
      message: {
        role: "user",
        content: "Respond with exactly the word 'ok' and nothing else.",
      },
      parent_tool_use_id: null,
    });

    try {
      await opts.waitForResult(state, 60_000);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      opts.log(`  Latency: ${elapsed.toFixed(0)}ms`);
    } catch (err: any) {
      opts.log(`  FAILED: ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (latencies.length === 0) {
    opts.log("FAIL: No successful responses");
    await opts.cleanup(state);
    process.exit(1);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  opts.log("=== BENCHMARK RESULTS ===");
  opts.log(`  Messages:  ${latencies.length}/${numMessages} successful`);
  opts.log(`  Average:   ${avg.toFixed(0)}ms`);
  opts.log(`  P50:       ${p50.toFixed(0)}ms`);
  opts.log(`  P95:       ${p95.toFixed(0)}ms`);
  opts.log(`  Min:       ${sorted[0].toFixed(0)}ms`);
  opts.log(`  Max:       ${sorted[sorted.length - 1].toFixed(0)}ms`);
  opts.log("=========================");

  await opts.cleanup(state);
  process.exit(0);
}
