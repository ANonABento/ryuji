/**
 * Twitter/X provider — posting via rettiwt-api (unofficial, no API key needed).
 *
 * Uses Twitter's internal GraphQL endpoints via session cookies.
 * Auth: constructs Rettiwt with LOGIN authType + username/password/email.
 * No developer account, no API key, no OAuth flow, $0.
 *
 * Supports: post tweets, post with images, threads.
 */

import { Rettiwt, type IRettiwtConfig } from "rettiwt-api";
import { errorMessage } from "@choomfie/shared";

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

interface RettiwtLoginConfig extends IRettiwtConfig {
  authType: "LOGIN";
  email: string;
  userName: string;
  password: string;
}

// --- Twitter Client ---

export class TwitterClient {
  private rettiwt: InstanceType<typeof Rettiwt> | null = null;
  private username: string = "";

  constructor() {}

  // --- Auth ---

  async login(config: TwitterConfig): Promise<string> {
    this.username = config.username;

    try {
      // Rettiwt LOGIN auth — pass credentials to constructor,
      // authenticates on first API call
      const loginConfig: RettiwtLoginConfig = {
        authType: "LOGIN",
        email: config.email,
        userName: config.username,
        password: config.password,
      };
      this.rettiwt = new Rettiwt(loginConfig);

      // Test the session by fetching own profile
      const me = await this.rettiwt.user.details(config.username);
      if (!me) throw new Error("Could not fetch user profile");

      return `Logged in as @${me.userName || config.username}`;
    } catch (error: unknown) {
      this.rettiwt = null;
      throw new Error(`Twitter login failed: ${errorMessage(error)}`);
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

    const id = await client.tweet.post({ text: tweetText });

    return {
      id,
      url: `https://x.com/${this.username}/status/${id}`,
    };
  }

  async postTweetWithMedia(tweetText: string, mediaPath: string): Promise<TweetResult> {
    const client = this.ensureClient();

    const mediaId = await client.tweet.upload(mediaPath);
    const id = await client.tweet.post({
      text: tweetText,
      media: [{ id: mediaId }],
    });

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
    const firstId = await client.tweet.post({ text: tweets[0] });
    results.push({
      id: firstId,
      url: `https://x.com/${this.username}/status/${firstId}`,
    });

    // Reply chain
    for (let i = 1; i < tweets.length; i++) {
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1500));

      const replyId = await client.tweet.post({
        text: tweets[i],
        replyTo: results[i - 1].id,
      });

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
