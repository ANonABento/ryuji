import { readFile, unlink } from "node:fs/promises";
import {
  DATA_DIR,
  PLUGIN_DIR,
  PID_PATH,
  TOKEN_THRESHOLD,
  TURN_THRESHOLD,
  WORKER_HEALTH_INTERVAL,
  WORKER_MAX_CONSECUTIVE_FAILURES,
} from "./constants.ts";
import {
  FLAG_BENCHMARK,
  FLAG_STATUS,
  FLAG_STOP,
  FLAG_TEST_CYCLE,
  FLAG_VERBOSE,
} from "./flags.ts";
import { getLastHandoffSummary, loadHandoffs } from "./handoffs.ts";
import { cleanup, createInitialState, setupShutdown } from "./lifecycle.ts";
import { log } from "./log.ts";
import { acquirePid } from "./pid.ts";
import { cycleSession, startSession, waitForResult } from "./runtime.ts";
import { DAEMON_STATE_PATH } from "./state-file.ts";
import { getErrorMessage } from "./error.ts";
import type { MetaState } from "./types.ts";

async function withCliSession(
  run: (state: MetaState) => Promise<number | void>
): Promise<void> {
  await acquirePid();
  const state = createInitialState();
  setupShutdown(state);

  try {
    await startSession(state);
    const result = await run(state);
    const exitCode = typeof result === "number" ? result : 0;
    await cleanup(state);
    process.exit(exitCode);
  } catch (error: unknown) {
    log(`CLI session failed: ${getErrorMessage(error)}`);
    await cleanup(state);
    process.exit(1);
  }
}

export async function testCycle(): Promise<void> {
  log("=== TEST: Session Cycling ===");
  await withCliSession(async (state) => {
    log("Sending test message...");
    state.pushMessage?.({
      type: "user",
      message: {
        role: "user",
        content: "Say hello and tell me your current persona name. Keep it brief.",
      },
      parent_tool_use_id: null,
    });

    log("Waiting for response...");
    try {
      const result = await waitForResult(state, 30_000);
      log(`Got response: ${result.result?.slice(0, 200)}`);
    } catch (error: unknown) {
      log(`Response wait failed: ${getErrorMessage(error)}`);
    }

    log("Waiting 10s before triggering cycle...");
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    log("Triggering manual cycle...");
    const preCycleTurns = state.turnCount;
    state.lastCycleReason = "manual_test";
    await cycleSession(state, state.totalInputTokens);

    if (state.state !== "ACTIVE") {
      log("FAIL: Session did not reach ACTIVE state after cycle");
      return 1;
    }

    const handoffs = await loadHandoffs();
    const lastHandoff = handoffs[handoffs.length - 1];
    if (!lastHandoff) {
      log("FAIL: No handoff entry found");
      return 1;
    }

    log(`Handoff summary (first 200 chars): ${lastHandoff.summary.slice(0, 200)}`);

    const isGenericFallback = lastHandoff.summary.startsWith("Session cycled at");
    if (isGenericFallback) {
      log("WARN: Got generic fallback summary — handoff capture may not have worked");
    } else {
      log("OK: Got meaningful handoff summary");
    }

    log("Sending post-cycle message...");
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
      const result = await waitForResult(state, 30_000);
      log(`Post-cycle response: ${result.result?.slice(0, 200)}`);
    } catch (error: unknown) {
      log(`Post-cycle response wait failed: ${getErrorMessage(error)}`);
    }

    log(`Turns before cycle: ${preCycleTurns}, after cycle reset to: ${state.turnCount}`);
    log("=== TEST COMPLETE: Session Cycling ===");
  });
}

export async function benchmark(): Promise<void> {
  log("=== BENCHMARK: Latency Measurement ===");
  await withCliSession(async (state) => {
    const NUM_MESSAGES = 5;
    const latencies: number[] = [];

    for (let i = 0; i < NUM_MESSAGES; i++) {
      log(`Message ${i + 1}/${NUM_MESSAGES}...`);
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
        await waitForResult(state, 60_000);
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        log(`  Latency: ${elapsed.toFixed(0)}ms`);
      } catch (error: unknown) {
        log(`  FAILED: ${getErrorMessage(error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (latencies.length === 0) {
      log("FAIL: No successful responses");
      return 1;
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    log("=== BENCHMARK RESULTS ===");
    log(`  Messages:  ${latencies.length}/${NUM_MESSAGES} successful`);
    log(`  Average:   ${avg.toFixed(0)}ms`);
    log(`  P50:       ${p50.toFixed(0)}ms`);
    log(`  P95:       ${p95.toFixed(0)}ms`);
    log(`  Min:       ${sorted[0].toFixed(0)}ms`);
    log(`  Max:       ${sorted[sorted.length - 1].toFixed(0)}ms`);
    log("=========================");
  });
}

export async function stopDaemon(): Promise<void> {
  try {
    const pidStr = await readFile(PID_PATH, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!pid || Number.isNaN(pid)) {
      console.error("No daemon PID found");
      process.exit(1);
    }

    try {
      process.kill(pid, 0);
    } catch {
      console.error(`Daemon PID ${pid} is not running (stale PID file)`);
      await unlink(PID_PATH).catch(() => {});
      process.exit(1);
    }

    console.error(`Sending SIGTERM to daemon (PID ${pid})...`);
    process.kill(pid, "SIGTERM");

    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        process.kill(pid, 0);
      } catch {
        console.error("Daemon stopped");
        process.exit(0);
      }
    }

    console.error("Daemon didn't stop gracefully, sending SIGKILL...");
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
    await unlink(PID_PATH).catch(() => {});
    console.error("Daemon killed");
    process.exit(0);
  } catch (error: unknown) {
    console.error(`Failed to stop daemon: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

export async function showStatus(): Promise<void> {
  let daemonPid: number | null = null;
  let running = false;
  try {
    const pidStr = await readFile(PID_PATH, "utf-8");
    daemonPid = parseInt(pidStr.trim(), 10);
    try {
      process.kill(daemonPid, 0);
      running = true;
    } catch {
      running = false;
    }
  } catch {
    console.error("Daemon: not running (no PID file)");
    process.exit(0);
  }

  if (!running) {
    console.error(`Daemon: not running (stale PID ${daemonPid})`);
    process.exit(0);
  }

  try {
    const proc = Bun.spawn(["ps", "-p", String(daemonPid), "-o", "etime=,rss=,command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = (await new Response(proc.stdout).text()).trim();
    await proc.exited;

    console.error(`Daemon: running (PID ${daemonPid})`);
    console.error(`  Process: ${output}`);
  } catch {
    // Status works without ps details.
  }

  try {
    const stateData = await readFile(DAEMON_STATE_PATH, "utf-8");
    const state = JSON.parse(stateData);
    console.error(`  State: ${state.state}`);
    console.error(`  Session: ${state.sessionId}`);
    console.error(`  Uptime: ${state.sessionUptimeSeconds}s`);
    console.error(`  Turns: ${state.turns?.current}/${state.turns?.threshold}`);
    console.error(`  Tokens: ${state.tokens?.current}/${state.tokens?.threshold}`);
    console.error(`  Cost: $${state.costUsd?.toFixed(4)}`);
    console.error(`  Cycles: ${state.totalCycles}`);
    console.error(`  Worker: ${state.workerHealth?.processAlive ? "alive" : "dead"}`);
    console.error(`  Updated: ${state.updatedAt}`);
  } catch {
    console.error("  State file not found");
  }

  process.exit(0);
}

export async function main(): Promise<void> {
  if (FLAG_STOP) return stopDaemon();
  if (FLAG_STATUS) return showStatus();
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_BENCHMARK) return benchmark();

  log("Choomfie daemon starting...");
  log(`Plugin directory: ${PLUGIN_DIR}`);
  log(`Data directory: ${DATA_DIR}`);
  log(`Thresholds: ${TOKEN_THRESHOLD} tokens, ${TURN_THRESHOLD} turns`);
  log(
    `Worker health: check every ${WORKER_HEALTH_INTERVAL / 1000}s, ` +
      `max ${WORKER_MAX_CONSECUTIVE_FAILURES} failures before recovery`
  );
  if (FLAG_VERBOSE) log("Verbose logging enabled");

  await acquirePid();
  log(`PID ${process.pid} acquired`);

  const handoffs = await loadHandoffs();
  const lastSummary = getLastHandoffSummary(handoffs);
  if (lastSummary) {
    log(`Found previous handoff summary (${handoffs.length} total)`);
  }

  const state = createInitialState();
  setupShutdown(state);
  await startSession(state, lastSummary);

  log("Daemon running. Press Ctrl+C to stop.");
  await new Promise(() => {});
}
