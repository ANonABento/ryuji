import { stopWorkerHealthMonitor } from "./daemon-health.ts";
import type { HandoffEntry, MetaState } from "./daemon-types.ts";

const MAX_ERROR_RETRIES = 10;

export async function handleStreamError(
  state: MetaState,
  err: any,
  opts: {
    loadHandoffs: () => Promise<HandoffEntry[]>;
    log: (msg: string) => void;
    maxRestartBackoff: number;
    startSession: (state: MetaState, handoffSummary?: string) => Promise<void>;
    verbose: (msg: string) => void;
  },
): Promise<void> {
  if (state.restartTask && state.state === "ACTIVE") {
    opts.verbose("Stream recovery already running");
  }
  if (state.state === "CYCLING" || state.state === "DRAINING") {
    opts.verbose("Stream error during cycling/draining — ignoring");
    return;
  }

  for (let attempt = 1; attempt <= MAX_ERROR_RETRIES; attempt++) {
    opts.log(`Session stream failed: ${err.message || err} (attempt ${attempt}/${MAX_ERROR_RETRIES})`);

    stopWorkerHealthMonitor(state);
    try {
      state.closeGenerator?.();
      state.session?.close();
    } catch {
      // Ignore best-effort cleanup failures during restart.
    }
    state.session = null;
    state.pushMessage = null;
    state.closeGenerator = null;
    state.resultWaiters = [];

    const delay = state.restartBackoff;
    state.restartBackoff = Math.min(state.restartBackoff * 2, opts.maxRestartBackoff);

    opts.log(`Restarting session in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    const handoffs = await opts.loadHandoffs();
    const lastSummary = handoffs.length > 0 ? handoffs[handoffs.length - 1].summary : undefined;

    try {
      await opts.startSession(state, lastSummary);
      opts.log("Session restarted successfully after error");
      return;
    } catch (restartErr: any) {
      err = restartErr;
    }
  }

  opts.log(`FATAL: Failed to restart session after ${MAX_ERROR_RETRIES} attempts. Exiting.`);
  process.exit(1);
}
