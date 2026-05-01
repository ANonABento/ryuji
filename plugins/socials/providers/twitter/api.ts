/**
 * Twitter/X provider — posting via rettiwt-api (unofficial, no API key needed).
 *
 * Uses Twitter's internal GraphQL endpoints via session cookies.
 * Auth: constructs Rettiwt with LOGIN authType + username/password/email.
 * No developer account, no API key, no OAuth flow, $0.
 *
 * Supports: post tweets, post with images, threads.
 */

import { AuthenticationType, Rettiwt } from "rettiwt-api";

// --- Types ---

export interface TwitterConfig {
  username: string;
  password: string;
  email: string;
}

export interface TweetResult {
  id: string;
  url: string;
}

type RettiwtClient = InstanceType<typeof Rettiwt> & {
  auth?: {
    login(email: string, username: string, password: string): Promise<string>;
  };
};

// --- Twitter Client ---

export class TwitterClient {
  private rettiwt: RettiwtClient | null = null;
  private username: string = "";

  // --- Auth ---

  async login(config: TwitterConfig): Promise<string> {
    this.username = config.username;

    try {
      // Rettiwt LOGIN auth — pass credentials to constructor,
      // authenticates on first API call
      this.rettiwt = new Rettiwt() as RettiwtClient;
      const apiKey = await this.rettiwt.auth?.login(
        config.email,
        config.username,
        config.password
      );
      if (apiKey) {
        this.rettiwt.apiKey = apiKey;
      }

      // Test the session by fetching own profile
      const me = await this.rettiwt.user.details(config.username);
      if (!me) throw new Error("Could not fetch user profile");

      return `Logged in as @${me.userName || config.username}`;
    } catch (error: unknown) {
      this.rettiwt = null;
      throw new Error(
        `Twitter login failed: ${error instanceof Error ? error.message : String(error)}`
      );
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

  private ensureClient(): RettiwtClient {
    if (!this.rettiwt) {
      throw new Error("Not logged in. Run twitter_auth first.");
    }
    return this.rettiwt;
  }

  // --- Posting ---

  async postTweet(tweetText: string): Promise<TweetResult> {
    const client = this.ensureClient();

    const result = await client.tweet.post({ text: tweetText });
    const id = result ?? "unknown";

    return {
      id,
      url: `https://x.com/${this.username}/status/${id}`,
    };
  }

  async postTweetWithMedia(tweetText: string, mediaPath: string): Promise<TweetResult> {
    const client = this.ensureClient();

    const mediaId = await client.tweet.upload(mediaPath);
    const result = await client.tweet.post({
      text: tweetText,
      media: [{ id: mediaId }],
    });
    const id = result ?? "unknown";

    return {
      id,
      url: `https://x.com/${this.username}/status/${id}`,
    };
  }

  async postThread(tweets: string[]): Promise<TweetResult[]> {
    if (tweets.length === 0) throw new Error("Thread must have at least one tweet");

    const client = this.ensureClient();
    const results: TweetResult[] = [];

    // First tweet
    const first = await client.tweet.post({ text: tweets[0] });
    const firstId = first ?? "unknown";
    results.push({
      id: firstId,
      url: `https://x.com/${this.username}/status/${firstId}`,
    });

    // Reply chain
    for (let i = 1; i < tweets.length; i++) {
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1500));

      const reply = (await client.tweet.post({
        text: tweets[i],
        replyTo: results[i - 1].id,
      });
      const replyId = reply ?? "unknown";

      results.push({
        id: replyId,
        url: `https://x.com/${this.username}/status/${replyId}`,
      });
    }

    return results;
  }

  // --- Cleanup ---

  destroy(): void {
    this.rettiwt = null;
  }
}
