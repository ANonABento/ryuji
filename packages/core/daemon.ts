#!/usr/bin/env bun
/**
 * Choomfie Daemon — autonomous mode entry point.
 *
 * Manages Claude Code sessions via the Agent SDK, cycling them when context
 * gets heavy. Monitors worker health and triggers recovery on failure.
 *
 * Architecture:
 *   daemon.ts (always running)
 *     └→ Claude Session (Agent SDK, loads Choomfie as plugin)
 *          └→ supervisor.ts (MCP stdio) → worker.ts (Discord)
 *
 * Usage:
 *   choomfie --daemon            # Normal operation
 *   bun daemon.ts --stop         # Stop running daemon (SIGTERM + cleanup)
 *   bun daemon.ts --status       # Show daemon status (PID, uptime, tokens, etc.)
 *   bun daemon.ts --test-cycle   # Test session cycling
 *   bun daemon.ts --benchmark    # Measure latency
 *   bun daemon.ts --verbose      # Debug output
 */

import {
  TURN_THRESHOLD,
  TOKEN_THRESHOLD,
  WORKER_HEALTH_INTERVAL,
  WORKER_MAX_CONSECUTIVE_FAILURES,
  DATA_DIR,
  PLUGIN_DIR,
} from "./daemon/constants.ts";
import {
  FLAG_BENCHMARK,
  FLAG_STATUS,
  FLAG_STOP,
  FLAG_TEST_CYCLE,
  FLAG_VERBOSE,
} from "./daemon/flags.ts";
import { loadHandoffs, getLastHandoffSummary } from "./daemon/handoffs.ts";
import { createInitialState, setupShutdown } from "./daemon/lifecycle.ts";
import { log } from "./daemon/log.ts";
import { acquirePid } from "./daemon/pid.ts";
import { startSession } from "./daemon/runtime.ts";
import { benchmark, showStatus, stopDaemon, testCycle } from "./daemon/cli.ts";

async function main(): Promise<void> {
  if (FLAG_STOP) return stopDaemon();
  if (FLAG_STATUS) return showStatus();
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_BENCHMARK) return benchmark();

  log("Choomfie daemon starting...");
  log(`Plugin directory: ${PLUGIN_DIR}`);
  log(`Data directory: ${DATA_DIR}`);
  log(`Thresholds: ${TOKEN_THRESHOLD} tokens, ${TURN_THRESHOLD} turns`);
  log(
    `Worker health: check every ${WORKER_HEALTH_INTERVAL / 1000}s, max ${WORKER_MAX_CONSECUTIVE_FAILURES} failures before recovery`
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

main().catch((err) => {
  log(`Fatal error: ${err.message || err}`);
  console.error(err);
  process.exit(1);
});
