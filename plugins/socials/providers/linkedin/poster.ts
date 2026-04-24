/**
 * LinkedIn poster adapter — translates a LinkedInPayload into the right
 * LinkedInClient call, fans out first-comment + monitor tracking on success.
 */

import type { LinkedInClient } from "./api.ts";
import type { LinkedInMonitor } from "./monitor.ts";
import type {
  LinkedInPayload,
  Poster,
  PublishResult,
} from "../scheduler-types.ts";

export class LinkedInPoster implements Poster<LinkedInPayload> {
  constructor(
    private client: LinkedInClient,
    private monitor: LinkedInMonitor | null,
  ) {}

  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  async publish(payload: LinkedInPayload): Promise<PublishResult> {
    let result: PublishResult;
    switch (payload.mediaType) {
      case "image":
        if (!payload.imageUrl) throw new Error("LinkedIn image post missing imageUrl");
        result = await this.client.postWithImage(payload.text, payload.imageUrl);
        break;
      case "link":
        if (!payload.linkUrl) throw new Error("LinkedIn link post missing linkUrl");
        result = await this.client.postWithLink(
          payload.text,
          payload.linkUrl,
          payload.linkTitle,
          payload.linkDescription,
        );
        break;
      default:
        result = await this.client.post(payload.text);
    }

    if (this.monitor && result.id) {
      this.monitor.trackPost(result.id, payload.text);
    }

    if (payload.firstComment && result.id) {
      try {
        await this.client.commentOnPost(result.id, payload.firstComment);
      } catch (e: any) {
        console.error(`[LinkedIn Poster] First comment failed: ${e.message}`);
      }
    }

    return result;
  }
}
