#!/usr/bin/env bun
/**
 * Choomfie Daemon — autonomous mode entry point.
 *
 * Manages Claude Code sessions via the Agent SDK, cycling them when context
 * gets heavy. Monitors worker health and triggers recovery on failure.
 * Supports automatic fallback from Anthropic to Ollama when the API is unavailable.
 *
 * Architecture:
 *   daemon.ts (always running)
 *     └→ Claude Session (Agent SDK, loads Choomfie as plugin)
 *          └→ supervisor.ts (MCP stdio) → worker.ts (Discord)
 *
 * Usage:
 *   choomfie --daemon              # Normal operation
 *   bun daemon.ts --stop           # Stop running daemon (SIGTERM + cleanup)
 *   bun daemon.ts --status         # Show daemon status (PID, uptime, tokens, etc.)
 *   bun daemon.ts --test-cycle     # Test session cycling
 *   bun daemon.ts --test-fallback  # Test Anthropic → Ollama fallback logic
 *   bun daemon.ts --benchmark      # Measure latency
 */

import { benchmark, showStatus, stopDaemon, testCycle, testFallback } from "./daemon/cli.ts";
import {
  FLAG_BENCHMARK,
  FLAG_STATUS,
  FLAG_STOP,
  FLAG_TEST_CYCLE,
  FLAG_TEST_FALLBACK,
} from "./daemon/flags.ts";
import { getLastHandoffSummary, loadHandoffs } from "./daemon/handoffs.ts";
import { createInitialState, setupShutdown } from "./daemon/lifecycle.ts";
import { log } from "./daemon/log.ts";
import { acquirePid } from "./daemon/pid.ts";
import { startSession } from "./daemon/runtime.ts";
import { getErrorMessage } from "./daemon/error.ts";

async function main(): Promise<void> {
  if (FLAG_STOP) return stopDaemon();
  if (FLAG_STATUS) return showStatus();
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_TEST_FALLBACK) return testFallback();
  if (FLAG_BENCHMARK) return benchmark();

  log("Choomfie daemon starting...");

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

main().catch((err: unknown) => {
  console.error(`[daemon] Fatal error: ${getErrorMessage(err)}`);
  process.exit(1);
});
