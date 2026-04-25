import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { META_DIR, PID_PATH } from "./constants.ts";
import { log } from "./log.ts";

export async function acquirePid(): Promise<void> {
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
          const ppid = parseInt(output.trim(), 10);
          const isOrphaned = ppid === 1;

          log(`Found old daemon (PID ${oldPid}${isOrphaned ? ", ORPHANED" : ""})`);
          log("Killing old daemon...");
          process.kill(oldPid, "SIGTERM");

          for (let i = 0; i < 6; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              process.kill(oldPid, 0);
            } catch {
              break;
            }
          }

          try {
            process.kill(oldPid, 0);
            log("Old daemon didn't stop gracefully, sending SIGKILL");
            process.kill(oldPid, "SIGKILL");
          } catch {
            // Already dead.
          }
        }
      } catch {
        // Process already dead.
      }
    }
  } catch {
    // No PID file yet.
  }

  await writeFile(PID_PATH, String(process.pid));
}

export async function releasePid(): Promise<void> {
  try {
    await unlink(PID_PATH);
  } catch {
    // PID file already gone.
  }
}
