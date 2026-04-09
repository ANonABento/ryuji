import type { ToolDef } from "@choomfie/shared";
import { linkedinEngagementTools } from "./linkedin-engagement-tools.ts";
import { linkedinManagementTools } from "./linkedin-management-tools.ts";
import { linkedinOpsTools } from "./linkedin-ops-tools.ts";
import { linkedinPublishingTools } from "./linkedin-publishing-tools.ts";

export const linkedinTools: ToolDef[] = [
  ...linkedinManagementTools,
  ...linkedinPublishingTools,
  ...linkedinEngagementTools,
  ...linkedinOpsTools,
];
