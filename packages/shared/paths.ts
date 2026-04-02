/**
 * Project root resolution — resilient to restructuring.
 *
 * Walks up from a starting directory until it finds the root package.json
 * (the one with "workspaces"). This replaces fragile import.meta.dir + "../.."
 * patterns throughout the codebase.
 */

import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

/** Walk up from a starting dir until we find the root package.json (the one with "workspaces"). */
export function findMonorepoRoot(from: string): string {
  let dir = from;
  while (dir !== "/") {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf-8"));
        if (parsed.workspaces) return dir;
      } catch {}
    }
    dir = dirname(dir);
  }
  // Fallback: assume 2 levels up from any package
  return join(from, "..", "..");
}
