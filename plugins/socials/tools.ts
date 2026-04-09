/**
 * Social platform tools — YouTube search/info, Reddit browse/search/post, LinkedIn posting.
 */

import type { ToolDef } from "@choomfie/shared";
import { youtubeTools } from "./youtube-tools.ts";
import { redditTools } from "./reddit-tools.ts";
import { linkedinTools } from "./linkedin-tools.ts";
import { twitterTools } from "./twitter-tools.ts";

export const socialsTools: ToolDef[] = [
  ...youtubeTools,
  ...redditTools,
  ...linkedinTools,
  ...twitterTools,
];
