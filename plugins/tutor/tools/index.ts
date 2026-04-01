/**
 * Tool registry — aggregates all tutor tools.
 */

import type { ToolDef } from "../../../lib/types.ts";
import { srsTools } from "./srs-tools.ts";
import { tutorTools } from "./tutor-tools.ts";
import { moduleTools } from "./module-tools.ts";
import { lessonTools } from "./lesson-tools.ts";
import { getAllModuleTools } from "../modules/index.ts";

export function getAllTutorTools(): ToolDef[] {
  return [
    ...tutorTools,
    ...moduleTools,
    ...srsTools,
    ...lessonTools,
    ...getAllModuleTools(),
  ];
}
