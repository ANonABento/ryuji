import type { LinkedInPostResult } from "./providers/types.ts";
import { getLinkedInMonitor } from "./linkedin-runtime.ts";
import type { PluginContext } from "@choomfie/shared";

const LINKEDIN_POST_LIMIT = 3000;

export function validateLinkedInText(text: string): string | null {
  return text.length > LINKEDIN_POST_LIMIT
    ? "LinkedIn posts are limited to 3000 characters."
    : null;
}

export function trackLinkedInPost(
  ctx: PluginContext,
  result: LinkedInPostResult,
  text: string,
): void {
  const monitor = getLinkedInMonitor(ctx);
  if (monitor && result.id) {
    monitor.trackPost(result.id, text);
  }
}

export function formatLinkedInPostResult(prefix: string, result: LinkedInPostResult): string {
  const urlLine = result.url ? `\nURL: ${result.url}` : "";
  return `${prefix}\nPost ID: ${result.id}${urlLine}`;
}
