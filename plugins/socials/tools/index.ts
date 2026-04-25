import type { ToolDef } from "@choomfie/shared";
import {
  destroyLinkedInClient,
  getLinkedInMonitor,
  getLinkedInScheduler,
  linkedinTools,
} from "./linkedin.ts";
import { redditTools } from "./reddit.ts";
import {
  destroyTwitterClient,
  twitterTools,
} from "./twitter.ts";
import { youtubeTools } from "./youtube.ts";

export const socialsTools: ToolDef[] = [
  ...youtubeTools,
  ...redditTools,
  ...linkedinTools,
  ...twitterTools,
];

export {
  destroyLinkedInClient,
  destroyTwitterClient,
  getLinkedInMonitor,
  getLinkedInScheduler,
};
