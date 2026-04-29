#!/usr/bin/env bun
/**
 * Choomfie daemon entry point.
 *
 * Session lifecycle implementation lives in packages/core/daemon/*.
 */

import { DATA_DIR, TOKEN_THRESHOLD, TURN_THRESHOLD } from "./daemon/constants.ts";
import { FLAG_BENCHMARK, FLAG_STATUS, FLAG_STOP, FLAG_TEST_CYCLE, FLAG_VERBOSE } from "./daemon/flags.ts";
import { getLastHandoffSummary, loadHandoffs } from "./daemon/handoffs.ts";
import { cleanup, createInitialState, setupShutdown } from "./daemon/lifecycle.ts";
import { log } from "./daemon/log.ts";
import { acquirePid } from "./daemon/pid.ts";
import { startSession } from "./daemon/runtime.ts";
import { benchmark, showStatus, stopDaemon, testCycle } from "./daemon/cli.ts";
import { getErrorMessage } from "./daemon/error.ts";

async function main(): Promise<void> {
  if (FLAG_STOP) return stopDaemon();
  if (FLAG_STATUS) return showStatus();
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_BENCHMARK) return benchmark();

  log("Choomfie daemon starting...");
  log(`Data directory: ${DATA_DIR}`);
  log(`Thresholds: ${TOKEN_THRESHOLD} tokens, ${TURN_THRESHOLD} turns`);
  if (FLAG_VERBOSE) log("Verbose logging enabled");

  await acquirePid();
  log(`PID ${process.pid} acquired`);

  const state = createInitialState();
  setupShutdown(state);

  try {
    const handoffs = await loadHandoffs();
    const lastSummary = getLastHandoffSummary(handoffs);
    if (lastSummary) {
      log(`Found previous handoff summary (${handoffs.length} total)`);
    }

    await startSession(state, lastSummary);
    log("Daemon running. Press Ctrl+C to stop.");
    await new Promise(() => {});
  } catch (error: unknown) {
    await cleanup(state);
    throw error;
  }
}

main().catch((error: unknown) => {
  log(`Fatal error: ${getErrorMessage(error)}`);
  console.error(error);
  process.exit(1);
});
