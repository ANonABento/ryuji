import { FLAG_VERBOSE } from "./flags.ts";

let currentSessionId = "boot";

export function setSessionId(sessionId: string): void {
  currentSessionId = sessionId;
}

export function log(msg: string): void {
  console.error(`[daemon:${currentSessionId}] ${new Date().toISOString()} ${msg}`);
}

export function verbose(msg: string): void {
  if (FLAG_VERBOSE) {
    console.error(`[daemon:${currentSessionId}:debug] ${new Date().toISOString()} ${msg}`);
  }
}
