#!/usr/bin/env bun
/**
 * Choomfie Meta-Supervisor — manages Claude Code sessions via the Agent SDK.
 *
 * Phase 3: The meta-supervisor is the top-level entry point. It manages:
 *   1. Claude Code sessions (Agent SDK) — cycled when context gets heavy
 *   2. Worker health monitoring — detects plugin worker issues, triggers recovery
 *
 * The worker is still spawned BY the Claude session (via the plugin system),
 * but meta-supervisor monitors its health and can trigger session cycles to
 * recover from worker failures.
 *
 * Architecture:
 *   meta.ts (always running)
 *     └→ Claude Session (Agent SDK, loads Choomfie as plugin)
 *          └→ supervisor.ts (MCP stdio) → worker.ts (Discord)
 *
 * Usage:
 *   bun meta.ts                 # Normal operation
 *   bun meta.ts --test-cycle    # Test session cycling
 *   bun meta.ts --benchmark     # Measure latency
 *   bun meta.ts --verbose       # Debug output
 */

import {
  query,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKResultSuccess,
  type SDKAssistantMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

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

import { findMonorepoRoot } from "@choomfie/shared";
const PLUGIN_DIR = findMonorepoRoot(import.meta.dir);

// --- CLI Flags ---

const ARGS = new Set(process.argv.slice(2));
const FLAG_TEST_CYCLE = ARGS.has("--test-cycle");
const FLAG_BENCHMARK = ARGS.has("--benchmark");
const FLAG_VERBOSE = ARGS.has("--verbose");

// --- Types ---

type SessionState = "STARTING" | "ACTIVE" | "DRAINING" | "CYCLING";

type HandoffEntry = {
  sessionId: string;
  timestamp: string;
  summary: string;
  tokenCount: number;
  turnCount: number;
  costUsd: number;
};

type WorkerHealthStatus = {
  /** Is the worker process alive (PID exists)? */
  processAlive: boolean;
  /** Last time worker was confirmed healthy */
  lastHealthyAt: number;
  /** Consecutive health check failures */
  consecutiveFailures: number;
};

type MetaState = {
  state: SessionState;
  session: Query | null;
  sessionId: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  sessionStartTime: number;
  messageQueue: SDKUserMessage[];
  contextCheckTimer: ReturnType<typeof setInterval> | null;
  contextCheckFailures: number;
  restartBackoff: number;
  pushMessage: ((msg: SDKUserMessage) => void) | null;
  closeGenerator: (() => void) | null;
  /** Resolvers waiting for the next result message from the session stream */
  resultWaiters: Array<(result: SDKResultSuccess) => void>;
  /** Last assistant text seen from the session stream */
  lastAssistantText: string | null;
  /** Worker health monitoring state */
  workerHealth: WorkerHealthStatus;
  /** Worker health check timer */
  workerHealthTimer: ReturnType<typeof setInterval> | null;
  /** Total session cycles performed */
  totalCycles: number;
  /** Reason for last cycle */
  lastCycleReason: string | null;
};

// --- Logging ---

let currentSessionId = "boot";

function log(msg: string) {
  console.error(`[meta:${currentSessionId}] ${new Date().toISOString()} ${msg}`);
}

function verbose(msg: string) {
  if (FLAG_VERBOSE) {
    console.error(`[meta:${currentSessionId}:debug] ${new Date().toISOString()} ${msg}`);
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
        if (command && (command.includes("meta.ts") || command.includes("choomfie"))) {
          log(`Killing old meta-supervisor (PID ${oldPid})`);
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

// --- Session Manager ---

function generateSessionId(): string {
  return `s-${Date.now().toString(36)}`;
}

function createMessageGenerator(): {
  generator: AsyncGenerator<SDKUserMessage>;
  push: (msg: SDKUserMessage) => void;
  close: () => void;
} {
  const queue: SDKUserMessage[] = [];
  let resolve: (() => void) | null = null;
  let closed = false;

  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => {
          resolve = r;
        });
        resolve = null;
      }
    }
  }

  return {
    generator: gen(),
    push(msg: SDKUserMessage) {
      queue.push(msg);
      resolve?.();
    },
    close() {
      closed = true;
      resolve?.();
    },
  };
}

function buildSystemPromptAppend(handoffSummary?: string): string {
  const parts: string[] = [];

  parts.push(
    "You are running under the Choomfie meta-supervisor (Phase 3). " +
      "Your session will be automatically cycled when context gets heavy. " +
      "The meta-supervisor monitors worker health and will cycle this session " +
      "if the Discord worker becomes unresponsive.\n\n" +
      "If asked for a handoff summary, provide a concise summary of the current conversation state, " +
      "active tasks, important context, and any pending work.\n\n" +
      "The meta-supervisor manages session cycling. The existing 'restart' tool in Choomfie " +
      "still works for restarting just the Discord worker. A full session cycle (which also " +
      "restarts the worker) happens automatically when context thresholds are reached or " +
      "when the worker is detected as unhealthy."
  );

  if (handoffSummary) {
    parts.push(
      "\n\n--- HANDOFF CONTEXT FROM PREVIOUS SESSION ---\n" +
        handoffSummary +
        "\n--- END HANDOFF CONTEXT ---"
    );
  }

  return parts.join("");
}

/**
 * Extract text content from an SDKAssistantMessage.
 * The message.message is a BetaMessage which has a content array of content blocks.
 */
function extractAssistantText(msg: SDKAssistantMessage): string | null {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return null;

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

async function startSession(
  state: MetaState,
  handoffSummary?: string
): Promise<void> {
  state.state = "STARTING";
  state.turnCount = 0;
  state.totalInputTokens = 0;
  state.totalOutputTokens = 0;
  state.totalCostUsd = 0;
  state.sessionStartTime = Date.now();
  state.contextCheckFailures = 0;
  state.lastAssistantText = null;
  state.resultWaiters = [];

  const sid = generateSessionId();
  state.sessionId = sid;
  currentSessionId = sid;

  log("Starting new Claude Code session...");

  const { generator, push, close: closeGenerator } = createMessageGenerator();

  state.pushMessage = push;
  state.closeGenerator = closeGenerator;

  const session = query({
    prompt: generator,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSystemPromptAppend(handoffSummary),
      },
      persistSession: true,
      includePartialMessages: false,
      settingSources: ["user", "project"],
      cwd: PLUGIN_DIR,
    },
  });

  state.session = session;

  // Start consuming the session stream in the background
  consumeSessionStream(state).catch((err) => {
    log(`Session stream error: ${err.message || err}`);
    handleStreamError(state, err);
  });

  // Wait a moment for session to initialize
  await new Promise((r) => setTimeout(r, 3000));

  state.state = "ACTIVE";
  log("Session active");

  // Start periodic context usage checks
  startContextMonitor(state);

  // Start worker health monitoring
  startWorkerHealthMonitor(state);

  // Replay any queued messages
  if (state.messageQueue.length > 0) {
    log(`Replaying ${state.messageQueue.length} queued messages`);
    for (const msg of state.messageQueue) {
      push(msg);
    }
    state.messageQueue = [];
  }

  // Reset backoff on successful start
  state.restartBackoff = INITIAL_RESTART_BACKOFF;
}

async function consumeSessionStream(state: MetaState): Promise<void> {
  if (!state.session) return;

  try {
    for await (const message of state.session) {
      handleSessionMessage(state, message);
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      log("Session aborted");
    } else {
      throw err; // Re-throw so the caller's .catch() handles it
    }
  }

  log("Session stream closed");
}

/**
 * Handle session stream errors with auto-restart and exponential backoff.
 */
async function handleStreamError(state: MetaState, err: any): Promise<void> {
  if (state.state === "CYCLING" || state.state === "DRAINING") {
    verbose("Stream error during cycling/draining — ignoring");
    return;
  }

  log(`Session stream failed unexpectedly: ${err.message || err}`);

  // Clean up current session and stop monitoring
  stopWorkerHealthMonitor(state);
  try {
    state.closeGenerator?.();
    state.session?.close();
  } catch {}
  state.session = null;
  state.pushMessage = null;
  state.closeGenerator = null;

  // Notify any waiting result consumers
  for (const waiter of state.resultWaiters) {
    // They'll get nothing — their timeout will handle it
  }
  state.resultWaiters = [];

  // Exponential backoff restart
  const delay = state.restartBackoff;
  state.restartBackoff = Math.min(state.restartBackoff * 2, MAX_RESTART_BACKOFF);

  log(`Restarting session in ${delay}ms (backoff: ${state.restartBackoff}ms)...`);
  await new Promise((r) => setTimeout(r, delay));

  // Get last handoff summary for continuity
  const handoffs = await loadHandoffs();
  const lastSummary = getLastHandoffSummary(handoffs);

  try {
    await startSession(state, lastSummary);
    log("Session restarted successfully after error");
  } catch (restartErr: any) {
    log(`Restart failed: ${restartErr.message || restartErr}`);
    // Try again with more backoff
    handleStreamError(state, restartErr);
  }
}

function handleSessionMessage(state: MetaState, message: SDKMessage): void {
  switch (message.type) {
    case "result": {
      const result = message as SDKResultMessage;
      if (result.subtype === "success") {
        const successResult = result as SDKResultSuccess;
        state.turnCount = successResult.num_turns;
        state.totalCostUsd = successResult.total_cost_usd;

        const usage = successResult.usage;
        if (usage) {
          state.totalInputTokens = usage.input_tokens ?? 0;
          state.totalOutputTokens = usage.output_tokens ?? 0;
        }

        log(
          `Turn complete: ${state.turnCount} turns, ` +
            `${state.totalInputTokens}/${TOKEN_THRESHOLD} input tokens, ` +
            `$${state.totalCostUsd.toFixed(4)}`
        );

        verbose(`Result text (first 200 chars): ${successResult.result?.slice(0, 200)}`);

        // Notify any waiters for this result
        if (state.resultWaiters.length > 0) {
          const waiter = state.resultWaiters.shift()!;
          waiter(successResult);
        }
      } else {
        log(`Session error result: ${JSON.stringify(result)}`);
      }
      break;
    }

    case "assistant": {
      const assistantMsg = message as SDKAssistantMessage;
      const text = extractAssistantText(assistantMsg);
      if (text) {
        state.lastAssistantText = text;
        verbose(`Assistant text (first 200 chars): ${text.slice(0, 200)}`);
      }
      break;
    }

    case "system": {
      if ((message as any).subtype === "compact_boundary") {
        log("Context compaction occurred");
      }
      break;
    }

    default:
      verbose(`Message type: ${message.type}`);
      break;
  }
}

function startContextMonitor(state: MetaState): void {
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
  }

  state.contextCheckTimer = setInterval(async () => {
    if (state.state !== "ACTIVE" || !state.session) return;

    try {
      const usage = await state.session.getContextUsage();
      const tokens = usage.totalTokens;
      const pct = usage.percentage;

      // Reset failure count on success
      state.contextCheckFailures = 0;

      log(
        `Context: ${tokens}/${usage.maxTokens} tokens (${pct.toFixed(1)}%), ` +
          `${state.turnCount}/${TURN_THRESHOLD} turns, ` +
          `$${state.totalCostUsd.toFixed(4)}`
      );

      if (shouldCycle(state, tokens)) {
        log("Threshold reached — initiating session cycle");
        await cycleSession(state, tokens);
      }
    } catch (err: any) {
      state.contextCheckFailures++;
      log(
        `Context check failed (${state.contextCheckFailures}/${CONTEXT_CHECK_FAILURE_LIMIT}): ${err.message || err}`
      );

      // Fall back to turn-count-based cycling if context checks keep failing
      if (state.contextCheckFailures >= CONTEXT_CHECK_FAILURE_LIMIT) {
        log("Context checks failing repeatedly — falling back to turn-count cycling");
        if (shouldCycle(state)) {
          log("Turn threshold reached (fallback) — initiating session cycle");
          await cycleSession(state);
        }
      }
    }
  }, CONTEXT_CHECK_INTERVAL);
}

function shouldCycle(state: MetaState, contextTokens?: number): boolean {
  if (state.state !== "ACTIVE") return false;

  // Check turn count
  if (state.turnCount >= TURN_THRESHOLD) return true;

  // Check token count (from context usage if available, otherwise from result tracking)
  const tokens = contextTokens ?? state.totalInputTokens;
  if (tokens >= TOKEN_THRESHOLD) return true;

  return false;
}

/**
 * Capture a handoff summary from the current session.
 * Pushes a message asking for a summary, then waits for the result with a timeout.
 */
async function captureHandoffSummary(state: MetaState): Promise<string> {
  if (!state.pushMessage || !state.session) {
    return "No summary available (no active session)";
  }

  // Push the handoff request
  state.pushMessage({
    type: "user",
    message: {
      role: "user",
      content:
        "Generate a handoff summary for session transition. Include: " +
        "1) Current conversation state and active persona " +
        "2) Recent topics discussed and with whom " +
        "3) Any pending tasks or ongoing work " +
        "4) Important context that should carry over " +
        "Keep it concise (under 500 words).",
    },
    parent_tool_use_id: null,
  });

  // Wait for the result using a promise-based approach
  try {
    const result = await waitForResult(state, HANDOFF_SUMMARY_TIMEOUT);
    // The result.result field contains the assistant's text response
    if (result.result && result.result.length > 0) {
      log(`Captured handoff summary (${result.result.length} chars)`);
      return result.result;
    }
    // Fallback: use the last assistant text we saw
    if (state.lastAssistantText) {
      log(`Using lastAssistantText as summary (${state.lastAssistantText.length} chars)`);
      return state.lastAssistantText;
    }
  } catch (err: any) {
    log(`Handoff summary capture failed: ${err.message || err}`);
    // Try the last assistant text as fallback
    if (state.lastAssistantText) {
      log("Falling back to last assistant text for summary");
      return state.lastAssistantText;
    }
  }

  return `Session cycled at ${state.turnCount} turns, ~${state.totalInputTokens} tokens, $${state.totalCostUsd.toFixed(4)}`;
}

/**
 * Wait for the next result message from the session stream.
 * Returns a promise that resolves when a result arrives or rejects on timeout.
 */
function waitForResult(state: MetaState, timeoutMs: number): Promise<SDKResultSuccess> {
  return new Promise<SDKResultSuccess>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove this waiter from the list
      const idx = state.resultWaiters.indexOf(waiterFn);
      if (idx !== -1) state.resultWaiters.splice(idx, 1);
      reject(new Error(`Timed out waiting for result after ${timeoutMs}ms`));
    }, timeoutMs);

    const waiterFn = (result: SDKResultSuccess) => {
      clearTimeout(timer);
      resolve(result);
    };

    state.resultWaiters.push(waiterFn);
  });
}

async function cycleSession(state: MetaState, tokenCount?: number): Promise<void> {
  if (state.state !== "ACTIVE") {
    log("Cannot cycle: not in ACTIVE state");
    return;
  }

  state.state = "DRAINING";
  state.totalCycles++;
  log(`Draining session... (cycle #${state.totalCycles}, reason: ${state.lastCycleReason || "threshold"})`);

  // Stop monitoring during cycle
  stopWorkerHealthMonitor(state);
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
    state.contextCheckTimer = null;
  }

  // Capture handoff summary from the live session
  const summary = await captureHandoffSummary(state);

  // Store handoff
  const handoff: HandoffEntry = {
    sessionId: state.sessionId,
    timestamp: new Date().toISOString(),
    summary,
    tokenCount: tokenCount ?? state.totalInputTokens,
    turnCount: state.turnCount,
    costUsd: state.totalCostUsd,
  };
  await saveHandoff(handoff);

  state.state = "CYCLING";
  log("Cycling session...");

  // Close old session
  try {
    state.closeGenerator?.();
    state.session?.close();
  } catch (err: any) {
    log(`Error closing session: ${err.message || err}`);
  }

  state.session = null;
  state.pushMessage = null;
  state.closeGenerator = null;
  state.resultWaiters = [];

  // Brief pause before starting new session
  await new Promise((r) => setTimeout(r, 2000));

  // Start new session with handoff summary
  await startSession(state, summary);
}

// --- Test: Session Cycling ---

async function testCycle(): Promise<void> {
  log("=== TEST: Session Cycling ===");

  await acquirePid();
  const state = createInitialState();

  // Graceful shutdown on signal
  setupShutdown(state);

  // Start session
  await startSession(state);

  // Send a test message
  log("Sending test message...");
  state.pushMessage?.({
    type: "user",
    message: {
      role: "user",
      content: "Say hello and tell me your current persona name. Keep it brief.",
    },
    parent_tool_use_id: null,
  });

  // Wait for response
  log("Waiting for response...");
  try {
    const result = await waitForResult(state, 30_000);
    log(`Got response: ${result.result?.slice(0, 200)}`);
  } catch (err: any) {
    log(`Response wait failed: ${err.message}`);
  }

  // Wait 10 seconds then trigger cycle
  log("Waiting 10s before triggering cycle...");
  await new Promise((r) => setTimeout(r, 10_000));

  log("Triggering manual cycle...");
  const preCycleTurns = state.turnCount;
  await cycleSession(state, state.totalInputTokens);

  // Verify new session started
  if (state.state !== "ACTIVE") {
    log("FAIL: Session did not reach ACTIVE state after cycle");
    await cleanup(state);
    process.exit(1);
  }

  // Verify handoff was persisted
  const handoffs = await loadHandoffs();
  const lastHandoff = handoffs[handoffs.length - 1];
  if (!lastHandoff) {
    log("FAIL: No handoff entry found");
    await cleanup(state);
    process.exit(1);
  }

  log(`Handoff summary (first 200 chars): ${lastHandoff.summary.slice(0, 200)}`);

  // Check if the summary is actually meaningful (not just the generic fallback)
  const isGenericFallback = lastHandoff.summary.startsWith("Session cycled at");
  if (isGenericFallback) {
    log("WARN: Got generic fallback summary — handoff capture may not have worked");
  } else {
    log("OK: Got meaningful handoff summary");
  }

  // Send another message to verify new session works with handoff context
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
    const result2 = await waitForResult(state, 30_000);
    log(`Post-cycle response: ${result2.result?.slice(0, 200)}`);
  } catch (err: any) {
    log(`Post-cycle response wait failed: ${err.message}`);
  }

  log("=== TEST COMPLETE: Session Cycling ===");
  await cleanup(state);
  process.exit(0);
}

// --- Benchmark: Latency Measurement ---

async function benchmark(): Promise<void> {
  log("=== BENCHMARK: Latency Measurement ===");

  await acquirePid();
  const state = createInitialState();
  setupShutdown(state);

  await startSession(state);

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
    } catch (err: any) {
      log(`  FAILED: ${err.message}`);
    }

    // Small gap between messages
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (latencies.length === 0) {
    log("FAIL: No successful responses");
    await cleanup(state);
    process.exit(1);
  }

  // Compute stats
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

  await cleanup(state);
  process.exit(0);
}

// --- Worker Health Monitoring ---

/**
 * Check if the worker process is alive by looking for the choomfie PID file
 * and verifying the supervisor process is running.
 */
async function checkWorkerProcessAlive(): Promise<boolean> {
  const supervisorPidPath = `${DATA_DIR}/choomfie.pid`;
  try {
    const pidStr = await readFile(supervisorPidPath, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!pid || isNaN(pid)) return false;

    // Check if the process is actually running
    const proc = Bun.spawn(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const command = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return command.length > 0 && (command.includes("choomfie") || command.includes("server.ts") || command.includes("supervisor"));
  } catch {
    return false;
  }
}

/**
 * Check worker health by sending a status tool call through the Claude session.
 * Uses the choomfie_status tool which returns uptime, persona, Discord status, etc.
 */
async function checkWorkerHealth(state: MetaState): Promise<void> {
  if (state.state !== "ACTIVE" || !state.pushMessage) {
    verbose("Skipping worker health check — session not active");
    return;
  }

  const processAlive = await checkWorkerProcessAlive();
  state.workerHealth.processAlive = processAlive;

  if (!processAlive) {
    state.workerHealth.consecutiveFailures++;
    log(
      `Worker health: process NOT alive ` +
        `(failure ${state.workerHealth.consecutiveFailures}/${WORKER_MAX_CONSECUTIVE_FAILURES})`
    );

    if (state.workerHealth.consecutiveFailures >= WORKER_MAX_CONSECUTIVE_FAILURES && state.state === "ACTIVE") {
      log("Worker appears dead — triggering session cycle to respawn");
      state.lastCycleReason = "worker_dead";
      stopWorkerHealthMonitor(state); // Prevent re-entry during cycle
      await cycleSession(state, state.totalInputTokens);
    }
    return;
  }

  // Process is alive — reset failure count
  state.workerHealth.consecutiveFailures = 0;
  state.workerHealth.lastHealthyAt = Date.now();

  verbose("Worker health: process alive");
}

/**
 * Start periodic worker health monitoring.
 */
function startWorkerHealthMonitor(state: MetaState): void {
  if (state.workerHealthTimer) {
    clearInterval(state.workerHealthTimer);
  }

  // Initial check after a delay (give worker time to start)
  setTimeout(() => checkWorkerHealth(state), 15_000);

  state.workerHealthTimer = setInterval(async () => {
    try {
      await checkWorkerHealth(state);
    } catch (err: any) {
      log(`Worker health check error: ${err.message || err}`);
    }
  }, WORKER_HEALTH_INTERVAL);
}

/**
 * Stop worker health monitoring.
 */
function stopWorkerHealthMonitor(state: MetaState): void {
  if (state.workerHealthTimer) {
    clearInterval(state.workerHealthTimer);
    state.workerHealthTimer = null;
  }
}

// --- Meta-Supervisor Tools ---

/**
 * Tools owned by the meta-supervisor itself.
 * These are injected into the Claude session's system prompt so Claude knows about them.
 * They're triggered by pushing a specific message to the session.
 */

/**
 * Trigger a manual session cycle. Called when Claude or the user wants to refresh context.
 * This is the Phase 3 equivalent of the old "restart" tool — but instead of just restarting
 * the worker, it cycles the entire Claude session (which also restarts the worker via the
 * plugin system).
 */
async function handleCycleRequest(state: MetaState, reason: string): Promise<void> {
  if (state.state !== "ACTIVE") {
    log(`Cannot cycle: state is ${state.state}, not ACTIVE`);
    return;
  }

  log(`Manual cycle requested: ${reason}`);
  state.lastCycleReason = reason;
  await cycleSession(state, state.totalInputTokens);
}

/**
 * Get the current meta-supervisor status including worker health.
 */
function getMetaStatus(state: MetaState): string {
  const uptime = state.sessionStartTime > 0
    ? Math.round((Date.now() - state.sessionStartTime) / 1000)
    : 0;

  const lines = [
    `Meta-Supervisor Status`,
    `  State: ${state.state}`,
    `  Session: ${state.sessionId}`,
    `  Session uptime: ${uptime}s`,
    `  Turns: ${state.turnCount}/${TURN_THRESHOLD}`,
    `  Input tokens: ${state.totalInputTokens}/${TOKEN_THRESHOLD}`,
    `  Cost: $${state.totalCostUsd.toFixed(4)}`,
    `  Total cycles: ${state.totalCycles}`,
    `  Last cycle reason: ${state.lastCycleReason || "none"}`,
    `  Worker health:`,
    `    Process alive: ${state.workerHealth.processAlive}`,
    `    Last healthy: ${state.workerHealth.lastHealthyAt ? new Date(state.workerHealth.lastHealthyAt).toISOString() : "never"}`,
    `    Consecutive failures: ${state.workerHealth.consecutiveFailures}`,
  ];

  return lines.join("\n");
}

// --- Helpers ---

function createInitialState(): MetaState {
  return {
    state: "STARTING",
    session: null,
    sessionId: generateSessionId(),
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    sessionStartTime: 0,
    messageQueue: [],
    contextCheckTimer: null,
    contextCheckFailures: 0,
    restartBackoff: INITIAL_RESTART_BACKOFF,
    pushMessage: null,
    closeGenerator: null,
    resultWaiters: [],
    lastAssistantText: null,
    workerHealth: {
      processAlive: false,
      lastHealthyAt: 0,
      consecutiveFailures: 0,
    },
    workerHealthTimer: null,
    totalCycles: 0,
    lastCycleReason: null,
  };
}

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
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_BENCHMARK) return benchmark();

  log("Choomfie Meta-Supervisor starting (Phase 3: supervisor collapse)...");
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
  const state = createInitialState();

  // Graceful shutdown
  setupShutdown(state);

  // Start first session
  await startSession(state, lastSummary);

  log("Meta-supervisor running. Press Ctrl+C to stop.");

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  log(`Fatal error: ${err.message || err}`);
  console.error(err);
  process.exit(1);
});
