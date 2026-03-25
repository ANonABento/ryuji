/**
 * Tool registry — aggregates all tool modules.
 * Future plugins just add their tools here.
 */

import type { ToolDef } from "../types.ts";
import { discordTools } from "./discord-tools.ts";
import { memoryTools } from "./memory-tools.ts";
import { personaTools } from "./persona-tools.ts";
import { reminderTools } from "./reminder-tools.ts";
import { githubTools } from "./github-tools.ts";
import { statusTools } from "./status-tools.ts";

export function getAllTools(): ToolDef[] {
  return [
    ...discordTools,
    ...memoryTools,
    ...personaTools,
    ...reminderTools,
    ...githubTools,
    ...statusTools,
  ];
}
