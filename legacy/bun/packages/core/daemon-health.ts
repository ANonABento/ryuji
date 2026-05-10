import { readFile } from "node:fs/promises";
import type { MetaState } from "./daemon-types.ts";

async function checkWorkerProcessAlive(dataDir: string): Promise<boolean> {
  const supervisorPidPath = `${dataDir}/choomfie.pid`;
  try {
    const pidStr = await readFile(supervisorPidPath, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!pid || Number.isNaN(pid)) return false;

    const proc = Bun.spawn(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const command = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return command.length > 0 && (
      command.includes("choomfie") ||
      command.includes("server.ts") ||
      command.includes("supervisor")
    );
  } catch {
    return false;
  }
}

async function checkWorkerHealth(
  state: MetaState,
  opts: {
    dataDir: string;
    maxConsecutiveFailures: number;
    log: (msg: string) => void;
    verbose: (msg: string) => void;
    cycleSession: (state: MetaState) => Promise<void>;
  },
): Promise<void> {
  if (state.state !== "ACTIVE" || !state.pushMessage) {
    opts.verbose("Skipping worker health check — session not active");
    return;
  }

  const processAlive = await checkWorkerProcessAlive(opts.dataDir);
  state.workerHealth.processAlive = processAlive;

  if (!processAlive) {
    state.workerHealth.consecutiveFailures++;
    opts.log(
      `Worker health: process NOT alive ` +
        `(failure ${state.workerHealth.consecutiveFailures}/${opts.maxConsecutiveFailures})`,
    );

    if (state.workerHealth.consecutiveFailures >= opts.maxConsecutiveFailures && state.state === "ACTIVE") {
      opts.log("Worker appears dead — triggering session cycle to respawn");
      state.lastCycleReason = "worker_dead";
      stopWorkerHealthMonitor(state);
      await opts.cycleSession(state);
    }
    return;
  }

  state.workerHealth.consecutiveFailures = 0;
  state.workerHealth.lastHealthyAt = Date.now();
  opts.verbose("Worker health: process alive");
}

export function startWorkerHealthMonitor(
  state: MetaState,
  opts: {
    dataDir: string;
    intervalMs: number;
    initialDelayMs: number;
    maxConsecutiveFailures: number;
    log: (msg: string) => void;
    verbose: (msg: string) => void;
    cycleSession: (state: MetaState) => Promise<void>;
  },
): void {
  stopWorkerHealthMonitor(state);

  setTimeout(() => {
    checkWorkerHealth(state, {
      dataDir: opts.dataDir,
      maxConsecutiveFailures: opts.maxConsecutiveFailures,
      log: opts.log,
      verbose: opts.verbose,
      cycleSession: opts.cycleSession,
    }).catch((err: any) => {
      opts.log(`Worker health check error: ${err.message || err}`);
    });
  }, opts.initialDelayMs);

  state.workerHealthTimer = setInterval(async () => {
    try {
      await checkWorkerHealth(state, {
        dataDir: opts.dataDir,
        maxConsecutiveFailures: opts.maxConsecutiveFailures,
        log: opts.log,
        verbose: opts.verbose,
        cycleSession: opts.cycleSession,
      });
    } catch (err: any) {
      opts.log(`Worker health check error: ${err.message || err}`);
    }
  }, opts.intervalMs);
}

export function stopWorkerHealthMonitor(state: MetaState): void {
  if (state.workerHealthTimer) {
    clearInterval(state.workerHealthTimer);
    state.workerHealthTimer = null;
  }
}
