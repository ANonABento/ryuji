/** Single source of truth for the version string. Reads from root package.json. */
import { readFileSync } from "node:fs";
import { findMonorepoRoot } from "./paths.ts";
import { join } from "node:path";

const root = findMonorepoRoot(import.meta.dir);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
export const VERSION: string = pkg.version;
