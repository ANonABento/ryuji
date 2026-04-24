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
  query,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKResultSuccess,
  type SDKAssistantMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { findMonorepoRoot } from "@choomfie/shared";
import {
  cloneBufferedMessage,
  composeHandoffSummary,
  parseChannelMessage,
  trackConversationActivity,
  type ConversationActivity,
} from "./lib/daemon-handoff.ts";
import {
  appendPendingMessage,
  clearPendingQueue,
  loadActiveConversations,
  loadPendingQueue,
  saveActiveConversations,
} from "./lib/daemon-queue.ts";

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
const FLAG_STOP = ARGS.has("--stop");
const FLAG_STATUS = ARGS.has("--status");

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
  totalCostUsd: number;
  sessionStartTime: number;
  messageQueue: SDKUserMessage[];
  activeConversations: ConversationActivity[];
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
  /** Wall-clock timestamp when DRAINING→CYCLING transition happened. Read by worker on reconnect for gap recovery. */
  lastCycleAt: number | null;
};

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
        const proc = Bun.spawn(["ps", "-p", String(oldPid), "-o", "ppid=,command="], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = (await new Response(proc.stdout).text()).trim();
        await proc.exited;

        if (output && (output.includes("daemon.ts") || output.includes("meta.ts"))) {
          // Check if it's orphaned (parent = 1 = launchd)
          const ppid = parseInt(output.trim(), 10);
          const isOrphaned = ppid === 1;

          log(`Found old daemon (PID ${oldPid}${isOrphaned ? ", ORPHANED" : ""})`);
          log(`Killing old daemon...`);
          process.kill(oldPid, "SIGTERM");

          // Wait for graceful shutdown, then force kill if needed
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try {
              process.kill(oldPid, 0);
            } catch {
              break; // Process died
            }
          }

          // Force kill if still alive
          try {
            process.kill(oldPid, 0);
            log("Old daemon didn't stop gracefully, sending SIGKILL");
            process.kill(oldPid, "SIGKILL");
          } catch {
            // Already dead
          }
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
    "You are running under the Choomfie daemon (Phase 3). " +
      "Your session will be automatically cycled when context gets heavy. " +
      "The daemon monitors worker health and will cycle this session " +
      "if the Discord worker becomes unresponsive.\n\n" +
      "If asked for a handoff summary, provide a concise summary of the current conversation state, " +
      "active tasks, important context, and any pending work.\n\n" +
      "The daemon manages session cycling. The existing 'restart' tool in Choomfie " +
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
      settings: {
        channelsEnabled: true,
      },
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

  // Persist state for worker /status reads
  writeDaemonState(state);

  // Start periodic context usage checks
  startContextMonitor(state);

  // Start worker health monitoring
  startWorkerHealthMonitor(state);

  // Replay queued messages — merge in-memory + disk queue (dedup by message_id)
  const diskQueue = await loadPendingQueue(META_DIR).catch((err) => {
    log(`Failed to load pending queue from disk: ${err.message || err}`);
    return [] as SDKUserMessage[];
  });

  const inMemoryCount = state.messageQueue.length;
  const seenMessageIds = new Set<string>();
  const merged: SDKUserMessage[] = [];

  for (const msg of state.messageQueue) {
    const parsed = parseChannelMessage(msg);
    const id = parsed?.attrs.message_id;
    if (id) seenMessageIds.add(id);
    merged.push(msg);
  }

  let fromDisk = 0;
  for (const msg of diskQueue) {
    const parsed = parseChannelMessage(msg);
    const id = parsed?.attrs.message_id;
    if (id && seenMessageIds.has(id)) continue;
    if (id) seenMessageIds.add(id);
    merged.push(msg);
    fromDisk++;
  }

  if (merged.length > 0) {
    log(
      `Replaying ${merged.length} queued messages (${fromDisk} from disk, ${inMemoryCount} in-memory)`
    );
    for (const msg of merged) {
      push(cloneBufferedMessage(msg));
    }
    state.messageQueue = [];

    await clearPendingQueue(META_DIR).catch((err) => {
      log(`Failed to clear persisted queue: ${err.message || err}`);
    });
    log("Cleared persisted queue");
  }

  // Reset backoff on successful start
  state.restartBackoff = INITIAL_RESTART_BACKOFF;

  // After a cycle (not first boot), notify Discord
  if (handoffSummary && state.totalCycles > 0) {
    log("Notifying Discord of session cycle...");
    push({
      type: "user",
      message: {
        role: "user",
        content:
          "Your daemon session was just cycled (fresh context). " +
          "Send a brief message to the most recently active Discord channel " +
          "letting them know you're back online. Keep it casual and short — " +
          "something like 'Back online, fresh brain. What were we doing?' " +
          "If no channel was active, skip this.",
      },
      parent_tool_use_id: null,
      isSynthetic: true,
    });
  }
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

const MAX_ERROR_RETRIES = 10;

/**
 * Handle session stream errors with auto-restart and exponential backoff.
 * Uses a loop instead of recursion to prevent stack overflow on persistent failures.
 */
async function handleStreamError(state: MetaState, err: any): Promise<void> {
  if (state.state === "CYCLING" || state.state === "DRAINING") {
    verbose("Stream error during cycling/draining — ignoring");
    return;
  }

  for (let attempt = 1; attempt <= MAX_ERROR_RETRIES; attempt++) {
    log(`Session stream failed: ${err.message || err} (attempt ${attempt}/${MAX_ERROR_RETRIES})`);

    // Clean up current session and stop monitoring
    stopWorkerHealthMonitor(state);
    try {
      state.closeGenerator?.();
      state.session?.close();
    } catch {}
    state.session = null;
    state.pushMessage = null;
    state.closeGenerator = null;
    state.resultWaiters = [];

    // Exponential backoff
    const delay = state.restartBackoff;
    state.restartBackoff = Math.min(state.restartBackoff * 2, MAX_RESTART_BACKOFF);

    log(`Restarting session in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));

    // Get last handoff summary for continuity
    const handoffs = await loadHandoffs();
    const lastSummary = getLastHandoffSummary(handoffs);

    try {
      await startSession(state, lastSummary);
      log("Session restarted successfully after error");
      return; // Success — exit retry loop
    } catch (restartErr: any) {
      err = restartErr; // Use this error for the next iteration's log
    }
  }

  log(`FATAL: Failed to restart session after ${MAX_ERROR_RETRIES} attempts. Exiting.`);
  await cleanup(state);
  process.exit(1);
}

function handleSessionMessage(state: MetaState, message: SDKMessage): void {
  switch (message.type) {
    case "user": {
      const userMessage = message as SDKUserMessage;
      const prevConversations = state.activeConversations;
      state.activeConversations = trackConversationActivity(state.activeConversations, userMessage);

      // Persist conversations whenever they change (array identity changes only
      // when trackConversationActivity actually updates — no-op otherwise)
      if (state.activeConversations !== prevConversations) {
        saveActiveConversations(META_DIR, state.activeConversations).catch((err) => {
          log(`Failed to persist active conversations: ${err.message || err}`);
        });
      }

      if (!userMessage.isSynthetic && state.state !== "ACTIVE") {
        const cloned = cloneBufferedMessage(userMessage);
        state.messageQueue.push(cloned);
        log(
          `Buffered inbound Discord message during ${state.state} (${state.messageQueue.length} queued)`
        );
        appendPendingMessage(META_DIR, cloned).catch((err) => {
          log(`Failed to persist buffered message: ${err.message || err}`);
        });
      }
      break;
    }

    case "result": {
      const result = message as SDKResultMessage;
      if (result.subtype === "success") {
        const successResult = result as SDKResultSuccess;
        state.turnCount = successResult.num_turns;
        state.totalCostUsd = successResult.total_cost_usd;

        const usage = successResult.usage;
        if (usage) {
          state.totalInputTokens += usage.input_tokens ?? 0;
        }

        log(
          `Turn ${state.turnCount}: +${usage?.input_tokens ?? 0} tokens, ` +
            `${state.totalInputTokens} total, $${state.totalCostUsd.toFixed(4)}`
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

      writeDaemonState(state);

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

  // Check context tokens (only from getContextUsage, not cumulative API usage)
  if (contextTokens !== undefined && contextTokens >= TOKEN_THRESHOLD) return true;

  return false;
}

/**
 * Capture a handoff summary from the current session.
 * Pushes a message asking for a summary, then waits for the result with a timeout.
 */
async function captureHandoffSummary(state: MetaState): Promise<string> {
  if (!state.pushMessage || !state.session) {
    return composeHandoffSummary(
      "No summary available (no active session).",
      state.activeConversations,
      state.messageQueue.length
    );
  }

  // Push the handoff request
  state.pushMessage({
    type: "user",
    message: {
      role: "user",
      content:
        "[DAEMON] Session cycling — generate a handoff summary. This will be injected into the next session's system prompt. Include:\n" +
        "1. Active persona name and key\n" +
        "2. Who you were talking to recently (Discord user IDs/names) and what about\n" +
        "3. Any active voice channels and who's in them\n" +
        "4. Ongoing conversations or tasks (what was the user asking for?)\n" +
        "5. Important things you learned this session (user preferences, facts to remember)\n" +
        "6. Any promises you made ('I'll remind you', 'I'll check on that')\n" +
        "Keep it under 500 words. Use structured format. Skip sections with nothing to report.\n" +
        "Do NOT use any tools — just output the summary text.",
    },
    parent_tool_use_id: null,
    isSynthetic: true,
  });

  // Wait for the result using a promise-based approach
  try {
    const result = await waitForResult(state, HANDOFF_SUMMARY_TIMEOUT);
    // The result.result field contains the assistant's text response
    if (result.result && result.result.length > 0) {
      log(`Captured handoff summary (${result.result.length} chars)`);
      return composeHandoffSummary(
        result.result,
        state.activeConversations,
        state.messageQueue.length
      );
    }
    // Fallback: use the last assistant text we saw
    if (state.lastAssistantText) {
      log(`Using lastAssistantText as summary (${state.lastAssistantText.length} chars)`);
      return composeHandoffSummary(
        state.lastAssistantText,
        state.activeConversations,
        state.messageQueue.length
      );
    }
  } catch (err: any) {
    log(`Handoff summary capture failed: ${err.message || err}`);
    // Try the last assistant text as fallback
    if (state.lastAssistantText) {
      log("Falling back to last assistant text for summary");
      return composeHandoffSummary(
        state.lastAssistantText,
        state.activeConversations,
        state.messageQueue.length
      );
    }
  }

  return composeHandoffSummary(
    `Session cycled at ${state.turnCount} turns, ~${state.totalInputTokens} tokens, $${state.totalCostUsd.toFixed(4)}`,
    state.activeConversations,
    state.messageQueue.length
  );
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

  // Mark the DRAINING→CYCLING boundary so worker gap-recovery can
  // filter messages that arrived after the cycle started.
  state.lastCycleAt = Date.now();
  state.state = "CYCLING";
  log("Cycling session...");
  writeDaemonState(state);

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
  state.activeConversations = await loadActiveConversations(META_DIR);

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
    isSynthetic: true,
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

  // Integration probe: simulate a gap-era Discord message persisted to disk
  // so we can verify it replays into the new session.
  log("Seeding disk queue with a simulated gap message...");
  const seedMessage: SDKUserMessage = {
    type: "user",
    message: {
      role: "user",
      content:
        '<channel source="choomfie" chat_id="test-chat" message_id="seed-1" user="tester" user_id="u-seed" ts="2026-04-24T00:00:00.000Z" is_dm="true" role="owner">seeded gap message</channel>',
    },
    parent_tool_use_id: null,
  };
  await appendPendingMessage(META_DIR, seedMessage);

  log("Triggering manual cycle...");
  const preCycleTurns = state.turnCount;
  await cycleSession(state, state.totalInputTokens);

  // Verify new session started
  if (state.state !== "ACTIVE") {
    log("FAIL: Session did not reach ACTIVE state after cycle");
    await cleanup(state);
    process.exit(1);
  }

  // Verify disk queue was drained + cleared
  const residualQueue = await loadPendingQueue(META_DIR);
  if (residualQueue.length > 0) {
    log(`FAIL: Pending queue not cleared after cycle (${residualQueue.length} entries remain)`);
    await cleanup(state);
    process.exit(1);
  }
  if (state.messageQueue.length !== 0) {
    log(`FAIL: In-memory queue not drained after cycle (${state.messageQueue.length} entries remain)`);
    await cleanup(state);
    process.exit(1);
  }
  log("OK: Disk queue drained + cleared after cycle");

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
    isSynthetic: true,
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
  state.activeConversations = await loadActiveConversations(META_DIR);
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
      isSynthetic: true,
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
      await cycleSession(state);
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

// --- Daemon State File ---

const DAEMON_STATE_PATH = `${META_DIR}/daemon-state.json`;

/**
 * Write daemon state to a JSON file so the worker can read it for /status.
 * Called periodically from the context monitor and after session lifecycle events.
 */
async function writeDaemonState(state: MetaState): Promise<void> {
  const uptime = state.sessionStartTime > 0
    ? Math.round((Date.now() - state.sessionStartTime) / 1000)
    : 0;

  const data = {
    mode: "daemon",
    pid: process.pid,
    state: state.state,
    sessionId: state.sessionId,
    sessionUptimeSeconds: uptime,
    turns: { current: state.turnCount, threshold: TURN_THRESHOLD },
    tokens: { current: state.totalInputTokens, threshold: TOKEN_THRESHOLD },
    costUsd: state.totalCostUsd,
    totalCycles: state.totalCycles,
    lastCycleReason: state.lastCycleReason,
    lastCycleAt: state.lastCycleAt,
    workerHealth: {
      processAlive: state.workerHealth.processAlive,
      lastHealthyAt: state.workerHealth.lastHealthyAt || null,
      consecutiveFailures: state.workerHealth.consecutiveFailures,
    },
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(DAEMON_STATE_PATH, JSON.stringify(data, null, 2));
  } catch (err: any) {
    log(`Failed to write daemon state: ${err.message}`);
  }
}

// --- Helpers ---

function createInitialState(): MetaState {
  return {
    state: "STARTING",
    session: null,
    sessionId: generateSessionId(),
    turnCount: 0,
    totalInputTokens: 0,
    totalCostUsd: 0,
    sessionStartTime: 0,
    messageQueue: [],
    activeConversations: [],
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
    lastCycleAt: null,
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
  try {
    await unlink(DAEMON_STATE_PATH);
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

// --- Stop / Status Commands ---

async function stopDaemon(): Promise<void> {
  try {
    const pidStr = await readFile(PID_PATH, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!pid || isNaN(pid)) {
      console.error("No daemon PID found");
      process.exit(1);
    }

    // Check if it's actually running
    try {
      process.kill(pid, 0); // Signal 0 = check existence
    } catch {
      console.error(`Daemon PID ${pid} is not running (stale PID file)`);
      await unlink(PID_PATH).catch(() => {});
      process.exit(1);
    }

    console.error(`Sending SIGTERM to daemon (PID ${pid})...`);
    process.kill(pid, "SIGTERM");

    // Wait up to 5s for graceful shutdown
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        process.kill(pid, 0);
      } catch {
        console.error("Daemon stopped");
        process.exit(0);
      }
    }

    // Force kill
    console.error("Daemon didn't stop gracefully, sending SIGKILL...");
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    await unlink(PID_PATH).catch(() => {});
    console.error("Daemon killed");
    process.exit(0);
  } catch (err: any) {
    console.error(`Failed to stop daemon: ${err.message}`);
    process.exit(1);
  }
}

async function showStatus(): Promise<void> {
  // Check PID
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

  // Check if the process is actually the daemon (not something else reusing the PID)
  try {
    const proc = Bun.spawn(["ps", "-p", String(daemonPid), "-o", "etime=,rss=,command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = (await new Response(proc.stdout).text()).trim();
    await proc.exited;

    console.error(`Daemon: running (PID ${daemonPid})`);
    console.error(`  Process: ${output}`);
  } catch {}

  // Read daemon state file
  try {
    const stateData = await readFile(`${META_DIR}/daemon-state.json`, "utf-8");
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

// --- Main ---

async function main(): Promise<void> {
  // Handle special modes
  if (FLAG_STOP) return stopDaemon();
  if (FLAG_STATUS) return showStatus();
  if (FLAG_TEST_CYCLE) return testCycle();
  if (FLAG_BENCHMARK) return benchmark();

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
  const state = createInitialState();
  state.activeConversations = await loadActiveConversations(META_DIR);
  if (state.activeConversations.length > 0) {
    log(`Hydrated ${state.activeConversations.length} active conversation(s) from disk`);
  }

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
