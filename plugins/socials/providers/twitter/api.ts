/**
 * Twitter/X provider — posting via rettiwt-api (unofficial, no API key needed).
 *
 * Uses Twitter's internal GraphQL endpoints via session cookies.
 * Auth: constructs Rettiwt with an API key cookie.
 * No developer account, no API key, no OAuth flow, $0.
 *
 * Supports: post tweets, post with images, threads.
 */

import { Rettiwt } from "rettiwt-api";

// --- Types ---

export interface TwitterConfig {
  apiKey: string;
  username: string;
}

export interface TweetResult {
  id: string;
  url: string;
}

// --- Twitter Client ---

export class TwitterClient {
  private rettiwt: InstanceType<typeof Rettiwt> | null = null;
  private username: string = "";

  // --- Auth ---

  async login(config: TwitterConfig): Promise<string> {
    this.username = config.username;

    try {
      this.rettiwt = new Rettiwt({
        apiKey: config.apiKey,
      });

      // Test the session by fetching own profile
      const me = await this.rettiwt.user.details(config.username);
      if (!me) throw new Error("Could not fetch user profile");

      return `Logged in as @${me.userName || config.username}`;
    } catch (e: unknown) {
      this.rettiwt = null;
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Twitter login failed: ${message}`);
    }
  }

  isAuthenticated(): boolean {
    return this.rettiwt !== null;
  }

  getStatus(): { authenticated: boolean; username: string } {
    return {
      authenticated: this.rettiwt !== null,
      username: this.username,
    };
  }

  private ensureClient(): InstanceType<typeof Rettiwt> {
    if (!this.rettiwt) {
      throw new Error("Not logged in. Run twitter_auth first.");
    }
    return this.rettiwt;
  }

  // --- Posting ---

  async postTweet(tweetText: string): Promise<TweetResult> {
    const client = this.ensureClient();

    const tweetId = await client.tweet.post({ text: tweetText });

    return {
      id: tweetId ?? "unknown",
      url: `https://x.com/${this.username}/status/${tweetId ?? "unknown"}`,
    };
  }

  async postTweetWithMedia(tweetText: string, mediaPath: string): Promise<TweetResult> {
    const client = this.ensureClient();
    const mediaId = await client.tweet.upload(mediaPath);

    const tweetId = await client.tweet.post({
      text: tweetText,
      media: [{ id: mediaId }],
    });

    return {
      id: tweetId ?? "unknown",
      url: `https://x.com/${this.username}/status/${tweetId ?? "unknown"}`,
    };
  }

  async postThread(tweets: string[]): Promise<TweetResult[]> {
    if (tweets.length === 0) throw new Error("Thread must have at least one tweet");

    const client = this.ensureClient();
    const results: TweetResult[] = [];

    // First tweet
    const firstTweetId = await client.tweet.post({ text: tweets[0] });
    results.push({
      id: firstTweetId ?? "unknown",
      url: `https://x.com/${this.username}/status/${firstTweetId ?? "unknown"}`,
    });

    // Reply chain
    for (let i = 1; i < tweets.length; i++) {
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1500));

      const replyTweetId = await client.tweet.post({
        text: tweets[i],
        replyTo: results[i - 1].id,
      });

      results.push({
        id: replyTweetId ?? "unknown",
        url: `https://x.com/${this.username}/status/${replyTweetId ?? "unknown"}`,
      });
    }

    return results;
  }

  // --- Cleanup ---

  destroy(): void {
    this.rettiwt = null;
  }
}
