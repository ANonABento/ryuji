#!/usr/bin/env bun
/**
 * Choomfie Daemon — autonomous mode entry point.
 */

import { main } from "./daemon/cli.ts";
import { getErrorMessage } from "./daemon/error.ts";
import { log } from "./daemon/log.ts";

main().catch((error: unknown) => {
  log(`Fatal error: ${getErrorMessage(error)}`);
  console.error(error);
  process.exit(1);
});
