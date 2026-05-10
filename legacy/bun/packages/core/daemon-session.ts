import {
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { startWorkerHealthMonitor, stopWorkerHealthMonitor } from "./daemon-health.ts";
import {
  buildSystemPromptAppend,
  captureHandoffSummary,
  createMessageGenerator,
  handleSessionMessage,
  waitForResult,
} from "./daemon-session-helpers.ts";
import { startContextMonitor } from "./daemon-session-monitor.ts";
import { handleStreamError } from "./daemon-session-recovery.ts";
import { writeDaemonState } from "./daemon-state.ts";
import type { HandoffEntry, MetaState } from "./daemon-types.ts";

type SessionRuntimeOptions = {
  contextCheckFailureLimit: number;
  contextCheckInterval: number;
  dataDir: string;
  handoffSummaryTimeout: number;
  initialRestartBackoff: number;
  log: (msg: string) => void;
  maxRestartBackoff: number;
  metaDir: string;
  pluginDir: string;
  saveHandoff: (entry: HandoffEntry) => Promise<void>;
  loadHandoffs: () => Promise<HandoffEntry[]>;
  setCurrentSessionId: (sessionId: string) => void;
  tokenThreshold: number;
  turnThreshold: number;
  verbose: (msg: string) => void;
  workerHealthInterval: number;
  workerMaxConsecutiveFailures: number;
};

export function generateSessionId(): string {
  return `s-${Date.now().toString(36)}`;
}

export function createDaemonSessionRuntime(opts: SessionRuntimeOptions) {
  async function startSession(state: MetaState, handoffSummary?: string): Promise<void> {
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
    opts.setCurrentSessionId(sid);

    opts.log("Starting new Claude Code session...");

    const { generator, push, close: closeGenerator } = createMessageGenerator();

    state.pushMessage = push;
    state.closeGenerator = closeGenerator;

    const session = query({
      prompt: generator,
      options: {
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        plugins: [{ type: "local", path: opts.pluginDir }],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: buildSystemPromptAppend(handoffSummary),
        },
        persistSession: true,
        includePartialMessages: false,
        settingSources: ["user", "project"],
        cwd: opts.pluginDir,
      },
    });

    state.session = session;

    const streamTask = consumeSessionStream(state)
      .catch(async (err) => {
        opts.log(`Session stream error: ${err.message || err}`);
        await handleStreamError(state, err);
      })
      .finally(() => {
        if (state.restartTask === streamTask) {
          state.restartTask = null;
        }
      });
    state.restartTask = streamTask;

    await new Promise((resolve) => setTimeout(resolve, 3000));

    state.state = "ACTIVE";
    opts.log("Session active");

    writeDaemonState(state, {
      metaDir: opts.metaDir,
      tokenThreshold: opts.tokenThreshold,
      turnThreshold: opts.turnThreshold,
      log: opts.log,
    });

    startContextMonitor(state, {
      contextCheckFailureLimit: opts.contextCheckFailureLimit,
      contextCheckInterval: opts.contextCheckInterval,
      cycleSession,
      log: opts.log,
      metaDir: opts.metaDir,
      tokenThreshold: opts.tokenThreshold,
      turnThreshold: opts.turnThreshold,
    });

    startWorkerHealthMonitor(state, {
      dataDir: opts.dataDir,
      intervalMs: opts.workerHealthInterval,
      initialDelayMs: 15_000,
      maxConsecutiveFailures: opts.workerMaxConsecutiveFailures,
      log: opts.log,
      verbose: opts.verbose,
      cycleSession: (nextState) => cycleSession(nextState),
    });

    if (state.messageQueue.length > 0) {
      opts.log(`Replaying ${state.messageQueue.length} queued messages`);
      for (const message of state.messageQueue) {
        push(message);
      }
      state.messageQueue = [];
    }

    state.restartBackoff = opts.initialRestartBackoff;

    if (handoffSummary && state.totalCycles > 0) {
      opts.log("Notifying Discord of session cycle...");
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
      });
    }
  }

  async function consumeSessionStream(state: MetaState): Promise<void> {
    if (!state.session) return;

    try {
      for await (const message of state.session) {
        handleSessionMessage(state, message, {
          log: opts.log,
          verbose: opts.verbose,
        });
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        opts.log("Session aborted");
      } else {
        throw err;
      }
    }

    opts.log("Session stream closed");
  }

  async function cycleSession(state: MetaState, tokenCount?: number): Promise<void> {
    if (state.state !== "ACTIVE") {
      opts.log("Cannot cycle: not in ACTIVE state");
      return;
    }

    state.state = "DRAINING";
    state.totalCycles++;
    opts.log(`Draining session... (cycle #${state.totalCycles}, reason: ${state.lastCycleReason || "threshold"})`);

    stopWorkerHealthMonitor(state);
    if (state.contextCheckTimer) {
      clearInterval(state.contextCheckTimer);
      state.contextCheckTimer = null;
    }

    const summary = await captureHandoffSummary(state, {
      handoffSummaryTimeout: opts.handoffSummaryTimeout,
      log: opts.log,
    });

    await opts.saveHandoff({
      sessionId: state.sessionId,
      timestamp: new Date().toISOString(),
      summary,
      tokenCount: tokenCount ?? state.totalInputTokens,
      turnCount: state.turnCount,
      costUsd: state.totalCostUsd,
    });

    state.state = "CYCLING";
    opts.log("Cycling session...");

    try {
      state.closeGenerator?.();
      state.session?.close();
    } catch (err: any) {
      opts.log(`Error closing session: ${err.message || err}`);
    }

    state.session = null;
    state.pushMessage = null;
    state.closeGenerator = null;
    state.resultWaiters = [];

    await new Promise((resolve) => setTimeout(resolve, 2000));
    await startSession(state, summary);
  }

  return {
    cycleSession,
    startSession,
    waitForResult,
  };
}
