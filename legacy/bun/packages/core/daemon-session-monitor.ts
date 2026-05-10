import { writeDaemonState } from "./daemon-state.ts";
import type { MetaState } from "./daemon-types.ts";

export function shouldCycle(
  state: MetaState,
  opts: {
    tokenThreshold: number;
    turnThreshold: number;
  },
  contextTokens?: number,
): boolean {
  if (state.state !== "ACTIVE") return false;
  if (state.turnCount >= opts.turnThreshold) return true;
  if (contextTokens !== undefined && contextTokens >= opts.tokenThreshold) return true;
  return false;
}

export function startContextMonitor(
  state: MetaState,
  opts: {
    contextCheckFailureLimit: number;
    contextCheckInterval: number;
    cycleSession: (state: MetaState, tokenCount?: number) => Promise<void>;
    log: (msg: string) => void;
    metaDir: string;
    tokenThreshold: number;
    turnThreshold: number;
  },
): void {
  if (state.contextCheckTimer) {
    clearInterval(state.contextCheckTimer);
  }

  state.contextCheckTimer = setInterval(async () => {
    if (state.state !== "ACTIVE" || !state.session) return;

    try {
      const usage = await state.session.getContextUsage();
      const tokens = usage.totalTokens;
      const pct = usage.percentage;

      state.contextCheckFailures = 0;

      opts.log(
        `Context: ${tokens}/${usage.maxTokens} tokens (${pct.toFixed(1)}%), ` +
          `${state.turnCount}/${opts.turnThreshold} turns, ` +
          `$${state.totalCostUsd.toFixed(4)}`,
      );

      writeDaemonState(state, {
        metaDir: opts.metaDir,
        tokenThreshold: opts.tokenThreshold,
        turnThreshold: opts.turnThreshold,
        log: opts.log,
      });

      if (shouldCycle(state, opts, tokens)) {
        opts.log("Threshold reached — initiating session cycle");
        await opts.cycleSession(state, tokens);
      }
    } catch (err: any) {
      state.contextCheckFailures++;
      opts.log(
        `Context check failed (${state.contextCheckFailures}/${opts.contextCheckFailureLimit}): ${err.message || err}`,
      );

      if (state.contextCheckFailures >= opts.contextCheckFailureLimit) {
        opts.log("Context checks failing repeatedly — falling back to turn-count cycling");
        if (shouldCycle(state, opts)) {
          opts.log("Turn threshold reached (fallback) — initiating session cycle");
          await opts.cycleSession(state);
        }
      }
    }
  }, opts.contextCheckInterval);
}
