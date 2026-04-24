/**
 * Twitter poster adapter — dispatches on payload.variant. Threads return the
 * root tweet's id/url as the canonical PublishResult; a partial-thread
 * failure surfaces as an error after some tweets are already live.
 */

import type { TwitterClient } from "./api.ts";
import { withRetry } from "../retry.ts";
import type {
  Poster,
  PublishResult,
  TwitterPayload,
} from "../scheduler-types.ts";

export class TwitterPoster implements Poster<TwitterPayload> {
  constructor(private client: TwitterClient) {}

  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  async publish(payload: TwitterPayload): Promise<PublishResult> {
    switch (payload.variant) {
      case "tweet": {
        if (!payload.text) throw new Error("Twitter tweet missing text");
        const text = payload.text;
        const r = await withRetry(() => this.client.postTweet(text), {
          label: "twitter_scheduled_post",
          maxAttempts: 2,
        });
        return { id: r.id, url: r.url };
      }
      case "tweetWithMedia": {
        if (!payload.text || !payload.imagePath) {
          throw new Error("Twitter media tweet missing text or imagePath");
        }
        const text = payload.text;
        const imagePath = payload.imagePath;
        const r = await withRetry(
          () => this.client.postTweetWithMedia(text, imagePath),
          { label: "twitter_scheduled_post_image", maxAttempts: 2 },
        );
        return { id: r.id, url: r.url };
      }
      case "thread": {
        if (!payload.tweets || payload.tweets.length === 0) {
          throw new Error("Twitter thread missing tweets");
        }
        const results = await this.client.postThread(payload.tweets);
        // Root tweet is canonical; partial failures throw inside postThread
        // before reaching here, in which case we never record success.
        const root = results[0];
        return { id: root.id, url: root.url };
      }
    }
  }
}
