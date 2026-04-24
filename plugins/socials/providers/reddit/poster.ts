/**
 * Reddit poster adapter — dispatches on payload.variant.
 */

import type { RedditClient } from "./api.ts";
import type {
  Poster,
  PublishResult,
  RedditPayload,
} from "../scheduler-types.ts";

export class RedditPoster implements Poster<RedditPayload> {
  constructor(private client: RedditClient) {}

  isAuthenticated(): boolean {
    // RedditClient auto-refreshes via password grant on every call.
    // Treat configured credentials as "authenticated" — actual auth failure
    // surfaces as an exception during publish().
    return true;
  }

  async publish(payload: RedditPayload): Promise<PublishResult> {
    switch (payload.variant) {
      case "self": {
        const r = await this.client.submitPost(
          payload.subreddit,
          payload.title,
          payload.text ?? "",
        );
        return { id: r.fullname, url: r.url };
      }
      case "link": {
        if (!payload.url) throw new Error("Reddit link post missing url");
        const r = await this.client.submitLink(
          payload.subreddit,
          payload.title,
          payload.url,
        );
        return { id: r.fullname, url: r.url };
      }
      case "image": {
        if (!payload.imagePath) throw new Error("Reddit image post missing imagePath");
        const r = await this.client.submitImage(
          payload.subreddit,
          payload.title,
          payload.imagePath,
          payload.text,
        );
        return { id: r.fullname, url: r.url };
      }
    }
  }
}
