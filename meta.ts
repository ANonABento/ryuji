#!/usr/bin/env bun
/**
 * Choomfie Meta-Supervisor — manages Claude Code sessions via the Agent SDK.
 *
 * Spawns a Claude Code session with Choomfie loaded as a plugin, monitors
 * token/turn usage, and cycles sessions when context gets heavy.
 *
 * Usage: bun meta.ts
 */

import { query, type Query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// --- Constants ---

const TOKEN_THRESHOLD = 120_000;
const TURN_THRESHOLD = 80;
const CONTEXT_CHECK_INTERVAL = 60_000; // Check context usage every 60s
const SESSION_START_TIMEOUT = 60_000; // 60s for session to start

const DATA_DIR =
  process.env.CLAUDE_PLUGIN_DATA ||
  `${process.env.HOME}/.claude/plugins/data/choomfie-inline`;
const META_DIR = `${DATA_DIR}/meta`;
const PID_PATH = `${META_DIR}/meta.pid`;
const HANDOFFS_PATH = `${META_DIR}/handoffs.json`;

const PLUGIN_DIR = import.meta.dir;

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

type MetaState = {
  state: SessionState;
  session: Query | null;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  sessionStartTime: number;
  messageQueue: SDKUserMessage[];
  contextCheckTimer: ReturnType<typeof setInterval> | null;
};

// --- Logging ---

function log(msg: string) {
  console.error(`[meta] ${new Date().toISOString()} ${msg}`);
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
        await new Promise<void>((r) => { resolve = r; });
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
    "You are running under the Choomfie meta-supervisor. " +
    "Your session will be automatically cycled when context gets heavy. " +
    "If asked for a handoff summary, provide a concise summary of the current conversation state, " +
    "active tasks, important context, and any pending work."
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

  log("Starting new Claude Code session...");

  const { generator, push, close: closeGenerator } = createMessageGenerator();

  // Store push/close on state for later use
  (state as any)._pushMessage = push;
  (state as any)._closeGenerator = closeGenerator;

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
  });

  // Wait a moment for session to initialize, then check MCP status
  await new Promise((r) => setTimeout(r, 3000));

  state.state = "ACTIVE";
  log("Session active");

  // Start periodic context usage checks
  startContextMonitor(state);

  // Replay any queued messages
  if (state.messageQueue.length > 0) {
    log(`Replaying ${state.messageQueue.length} queued messages`);
    for (const msg of state.messageQueue) {
      push(msg);
    }
    state.messageQueue = [];
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
      log(`Session stream ended: ${err.message || err}`);
    }
  }

  log("Session stream closed");
}

function handleSessionMessage(state: MetaState, message: SDKMessage): void {
  switch (message.type) {
    case "result": {
      const result = message as SDKResultMessage;
      if (result.subtype === "success") {
        state.turnCount = result.num_turns;
        state.totalCostUsd = result.total_cost_usd;

        // Extract token usage from the result
        const usage = result.usage;
        if (usage) {
          state.totalInputTokens = usage.input_tokens ?? 0;
          state.totalOutputTokens = usage.output_tokens ?? 0;
        }

        log(
          `Turn complete: ${state.turnCount} turns, ` +
          `${state.totalInputTokens}/${TOKEN_THRESHOLD} input tokens, ` +
          `$${state.totalCostUsd.toFixed(4)}`
        );
      } else {
        // Error result
        log(`Session error result: ${JSON.stringify(result)}`);
      }
      break;
    }

    case "assistant": {
      // Track assistant messages for turn counting
      break;
    }

    case "system": {
      // Log system messages (compaction boundaries, etc.)
      if ((message as any).subtype === "compact_boundary") {
        log("Context compaction occurred");
      }
      break;
    }

    default:
      // Other message types (status, auth, etc.) — ignore silently
      break;
  }
}

function startContextMonitor(state: MetaState): void {
  // Clear any existing timer
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
  }

  state.contextCheckTimer = setInterval(async () => {
    if (state.state !== "ACTIVE" || !state.session) return;

    try {
      const usage = await state.session.getContextUsage();
      const tokens = usage.totalTokens;
      const pct = usage.percentage;

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
      // Session might be busy or shutting down
      log(`Context check failed: ${err.message || err}`);
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

async function cycleSession(state: MetaState, tokenCount?: number): Promise<void> {
  if (state.state !== "ACTIVE") {
    log("Cannot cycle: not in ACTIVE state");
    return;
  }

  state.state = "DRAINING";
  log("Draining session...");

  // Stop context monitoring
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
    state.contextCheckTimer = null;
  }

  let summary = "No summary available (session cycling)";

  // Ask Claude to generate a handoff summary
  try {
    const pushMessage = (state as any)._pushMessage as (msg: SDKUserMessage) => void;
    if (pushMessage && state.session) {
      pushMessage({
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

      // Wait for the result with a timeout
      const summaryTimeout = 30_000;
      const start = Date.now();

      // Consume messages until we get a result or timeout
      while (Date.now() - start < summaryTimeout) {
        await new Promise((r) => setTimeout(r, 1000));
        // The result will be captured by handleSessionMessage
        // We just need to wait a reasonable time
        if (state.turnCount > 0) break;
      }

      // Try to get the summary from the session result
      // The last assistant message should contain the summary
      summary = `Session cycled at ${state.turnCount} turns, ~${tokenCount ?? state.totalInputTokens} tokens, $${state.totalCostUsd.toFixed(4)}`;
    }
  } catch (err: any) {
    log(`Failed to generate handoff summary: ${err.message || err}`);
  }

  // Store handoff
  const handoff: HandoffEntry = {
    sessionId: `session-${state.sessionStartTime}`,
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
    const closeGenerator = (state as any)._closeGenerator as () => void;
    closeGenerator?.();
    state.session?.close();
  } catch (err: any) {
    log(`Error closing session: ${err.message || err}`);
  }

  state.session = null;

  // Brief pause before starting new session
  await new Promise((r) => setTimeout(r, 2000));

  // Start new session with handoff summary
  await startSession(state, summary);
}

// --- Main ---

async function main(): Promise<void> {
  log("Choomfie Meta-Supervisor starting...");
  log(`Plugin directory: ${PLUGIN_DIR}`);
  log(`Data directory: ${DATA_DIR}`);
  log(`Thresholds: ${TOKEN_THRESHOLD} tokens, ${TURN_THRESHOLD} turns`);

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
  const state: MetaState = {
    state: "STARTING",
    session: null,
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    sessionStartTime: 0,
    messageQueue: [],
    contextCheckTimer: null,
  };

  // Graceful shutdown
  let shutdownCalled = false;
  const shutdown = async () => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    log("Shutting down...");

    // Stop context monitor
    if (state.contextCheckTimer) {
      clearInterval(state.contextCheckTimer);
      state.contextCheckTimer = null;
    }

    // Close session
    if (state.session) {
      try {
        const closeGenerator = (state as any)._closeGenerator as () => void;
        closeGenerator?.();
        state.session.close();
      } catch {}
    }

    // Clean up PID
    await releasePid();

    log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

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
