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
 *   bun daemon.ts --test-cycle   # Test session cycling
 *   bun daemon.ts --benchmark    # Measure latency
 *   bun daemon.ts --verbose      # Debug output
 */

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { findMonorepoRoot } from "@choomfie/shared";
import { stopWorkerHealthMonitor } from "./daemon-health.ts";
import { runCycleTest, runLatencyBenchmark } from "./daemon-modes.ts";
import { generateSessionId, createDaemonSessionRuntime } from "./daemon-session.ts";
import { createInitialState } from "./daemon-state.ts";
import type { HandoffEntry, MetaState } from "./daemon-types.ts";

// --- Constants ---

const TOKEN_THRESHOLD = 120_000;
const TURN_THRESHOLD = 80;
const CONTEXT_CHECK_INTERVAL = 60_000; // Check context usage every 60s
const HANDOFF_SUMMARY_TIMEOUT = 30_000; // 30s to generate handoff summary
const MAX_RESTART_BACKOFF = 60_000; // Max 60s between restart attempts
const INITIAL_RESTART_BACKOFF = 2_000; // Start with 2s backoff
const CONTEXT_CHECK_FAILURE_LIMIT = 5; // Fall back to turn-count after N failures
const WORKER_HEALTH_INTERVAL = 30_000; // Check worker health every 30s
const WORKER_MAX_CONSECUTIVE_FAILURES = 3; // Trigger recovery after 3 consecutive failures

const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA ||
  `${process.env.HOME}/.claude/plugins/data/choomfie-inline`;
const META_DIR = `${DATA_DIR}/meta`;
const PID_PATH = `${META_DIR}/meta.pid`;
const HANDOFFS_PATH = `${META_DIR}/handoffs.json`;

const PLUGIN_DIR = findMonorepoRoot(import.meta.dir);

// --- CLI Flags ---

const ARGS = new Set(process.argv.slice(2));
const FLAG_TEST_CYCLE = ARGS.has("--test-cycle");
const FLAG_BENCHMARK = ARGS.has("--benchmark");
const FLAG_VERBOSE = ARGS.has("--verbose");

// --- Logging ---

let currentSessionId = "boot";

function log(msg: string) {
  console.error(`[daemon:${currentSessionId}] ${new Date().toISOString()} ${msg}`);
}

function verbose(msg: string) {
  if (FLAG_VERBOSE) {
    console.error(`[daemon:${currentSessionId}:debug] ${new Date().toISOString()} ${msg}`);
  }
}

// --- PID Guard ---

async function acquirePid(): Promise<void> {
  await mkdir(META_DIR, { recursive: true });

  try {
    const oldPid = parseInt(await readFile(PID_PATH, "utf-8"), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        const proc = Bun.spawn(["ps", "-p", String(oldPid), "-o", "command="], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const command = (await new Response(proc.stdout).text()).trim();
        await proc.exited;
        if (command && (command.includes("daemon.ts") || command.includes("choomfie"))) {
          log(`Killing old daemon (PID ${oldPid})`);
          process.kill(oldPid, "SIGTERM");
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        // Process already dead
      }
    }
  } catch {
    // No PID file yet
  }

  await writeFile(PID_PATH, String(process.pid));
}

async function releasePid(): Promise<void> {
  try {
    await unlink(PID_PATH);
  } catch {}
}

// --- Handoff Storage ---

async function loadHandoffs(): Promise<HandoffEntry[]> {
  try {
    const data = await readFile(HANDOFFS_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveHandoff(entry: HandoffEntry): Promise<void> {
  const handoffs = await loadHandoffs();
  handoffs.push(entry);
  // Keep last 20 handoffs
  const trimmed = handoffs.slice(-20);
  await writeFile(HANDOFFS_PATH, JSON.stringify(trimmed, null, 2));
}

function getLastHandoffSummary(handoffs: HandoffEntry[]): string | undefined {
  if (handoffs.length === 0) return undefined;
  return handoffs[handoffs.length - 1].summary;
}

const { cycleSession, startSession, waitForResult } = createDaemonSessionRuntime({
  contextCheckFailureLimit: CONTEXT_CHECK_FAILURE_LIMIT,
  contextCheckInterval: CONTEXT_CHECK_INTERVAL,
  dataDir: DATA_DIR,
  handoffSummaryTimeout: HANDOFF_SUMMARY_TIMEOUT,
  initialRestartBackoff: INITIAL_RESTART_BACKOFF,
  log,
  maxRestartBackoff: MAX_RESTART_BACKOFF,
  metaDir: META_DIR,
  pluginDir: PLUGIN_DIR,
  saveHandoff,
  loadHandoffs,
  setCurrentSessionId: (sessionId) => {
    currentSessionId = sessionId;
  },
  tokenThreshold: TOKEN_THRESHOLD,
  turnThreshold: TURN_THRESHOLD,
  verbose,
  workerHealthInterval: WORKER_HEALTH_INTERVAL,
  workerMaxConsecutiveFailures: WORKER_MAX_CONSECUTIVE_FAILURES,
});

// --- Helpers ---

async function cleanup(state: MetaState): Promise<void> {
  stopWorkerHealthMonitor(state);
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
    state.contextCheckTimer = null;
  }
  try {
    state.closeGenerator?.();
    state.session?.close();
  } catch {}
  try {
    await unlink(`${META_DIR}/daemon-state.json`);
  } catch {}
  await releasePid();
}

function setupShutdown(state: MetaState): void {
  let shutdownCalled = false;
  const shutdown = async () => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    log("Shutting down...");
    await cleanup(state);
    log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
}

// --- Main ---

async function main(): Promise<void> {
  // Handle special modes
  if (FLAG_TEST_CYCLE) {
    return runCycleTest({
      acquirePid,
      cleanup,
      createState: () => createInitialState(generateSessionId, INITIAL_RESTART_BACKOFF),
      cycleSession,
      loadHandoffs,
      log,
      setupShutdown,
      startSession,
      waitForResult,
    });
  }
  if (FLAG_BENCHMARK) {
    return runLatencyBenchmark({
      acquirePid,
      cleanup,
      createState: () => createInitialState(generateSessionId, INITIAL_RESTART_BACKOFF),
      cycleSession,
      loadHandoffs,
      log,
      setupShutdown,
      startSession,
      waitForResult,
    });
  }

  log("Choomfie daemon starting...");
  log(`Plugin directory: ${PLUGIN_DIR}`);
  log(`Data directory: ${DATA_DIR}`);
  log(`Thresholds: ${TOKEN_THRESHOLD} tokens, ${TURN_THRESHOLD} turns`);
  log(`Worker health: check every ${WORKER_HEALTH_INTERVAL / 1000}s, max ${WORKER_MAX_CONSECUTIVE_FAILURES} failures before recovery`);
  if (FLAG_VERBOSE) log("Verbose logging enabled");

  // Acquire PID
  await acquirePid();
  log(`PID ${process.pid} acquired`);

  // Load previous handoffs
  const handoffs = await loadHandoffs();
  const lastSummary = getLastHandoffSummary(handoffs);
  if (lastSummary) {
    log(`Found previous handoff summary (${handoffs.length} total)`);
  }

  // Initialize state
  const state = createInitialState(generateSessionId, INITIAL_RESTART_BACKOFF);

  // Graceful shutdown
  setupShutdown(state);

  // Start first session
  await startSession(state, lastSummary);

  log("Daemon running. Press Ctrl+C to stop.");

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  log(`Fatal error: ${err.message || err}`);
  console.error(err);
  process.exit(1);
});
