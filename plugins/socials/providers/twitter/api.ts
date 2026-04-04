/**
 * Twitter/X provider — posting via rettiwt-api (unofficial, no API key needed).
 *
 * Uses Twitter's internal GraphQL endpoints via session cookies.
 * Auth: username + password + email → session cookie stored locally.
 * No developer account, no API key, no OAuth flow, $0.
 *
 * Supports: post tweets, post with images, threads.
 */

import { Rettiwt } from "rettiwt-api";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

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

// --- Twitter Client ---

export class TwitterClient {
  private rettiwt: InstanceType<typeof Rettiwt> | null = null;
  private cookiePath: string;
  private username: string = "";

  constructor(dataDir: string) {
    const socialsDir = `${dataDir}/socials`;
    if (!existsSync(socialsDir)) {
      mkdirSync(socialsDir, { recursive: true });
    }
    this.cookiePath = `${socialsDir}/twitter-session`;
  }

  // --- Auth ---

  /**
   * Login with username/password/email. Stores session cookies for reuse.
   */
  async login(config: TwitterConfig): Promise<string> {
    this.username = config.username;

    try {
      // Try loading existing cookies first
      if (existsSync(this.cookiePath)) {
        const cookieStr = readFileSync(this.cookiePath, "utf-8");
        this.rettiwt = new Rettiwt({ apiKey: cookieStr });

        // Test the session
        try {
          const me = await this.rettiwt.user.details(config.username);
          if (me) {
            return `Logged in as @${config.username} (cached session)`;
          }
        } catch {
          // Cached session expired, re-login below
          this.rettiwt = null;
        }
      }

      // Fresh login
      this.rettiwt = new Rettiwt();
      const apiKey = await this.rettiwt.auth.login(
        config.email,
        config.username,
        config.password,
      );

      // Save cookies for reuse
      writeFileSync(this.cookiePath, apiKey);

      // Re-init with the API key
      this.rettiwt = new Rettiwt({ apiKey });

      return `Logged in as @${config.username}`;
    } catch (e: any) {
      this.rettiwt = null;
      throw new Error(`Twitter login failed: ${e.message}`);
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

  /**
   * Try to restore session from cached cookies (called automatically on first tool use).
   */
  tryRestoreSession(): boolean {
    if (this.rettiwt) return true;

    try {
      if (existsSync(this.cookiePath)) {
        const cookieStr = readFileSync(this.cookiePath, "utf-8");
        if (cookieStr) {
          this.rettiwt = new Rettiwt({ apiKey: cookieStr });
          return true;
        }
      }
    } catch {
      // Can't restore — user needs to run twitter_auth
    }
    return false;
  }

  private ensureClient(): InstanceType<typeof Rettiwt> {
    if (!this.rettiwt) {
      // Try cached session before giving up
      this.tryRestoreSession();
    }
    if (!this.rettiwt) {
      throw new Error("Not logged in. Run twitter_auth first.");
    }
    return this.rettiwt;
  }

  // --- Posting ---

  async postTweet(text: string): Promise<TweetResult> {
    const client = this.ensureClient();

    const result = await client.tweet.post({ text });

    return {
      id: result?.id ?? "unknown",
      url: `https://x.com/${this.username}/status/${result?.id ?? "unknown"}`,
    };
  }

  async postTweetWithMedia(text: string, mediaPath: string): Promise<TweetResult> {
    const client = this.ensureClient();

    // Read the media file
    const media = [{ path: mediaPath }];

    const result = await client.tweet.post({ text, media });

    return {
      id: result?.id ?? "unknown",
      url: `https://x.com/${this.username}/status/${result?.id ?? "unknown"}`,
    };
  }

  async postThread(tweets: string[]): Promise<TweetResult[]> {
    if (tweets.length === 0) throw new Error("Thread must have at least one tweet");

    const client = this.ensureClient();
    const results: TweetResult[] = [];

    // First tweet
    const first = await client.tweet.post({ text: tweets[0] });
    results.push({
      id: first?.id ?? "unknown",
      url: `https://x.com/${this.username}/status/${first?.id ?? "unknown"}`,
    });

    // Reply chain
    for (let i = 1; i < tweets.length; i++) {
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));

      const reply = await client.tweet.post({
        text: tweets[i],
        replyTo: results[i - 1].id,
      });

      results.push({
        id: reply?.id ?? "unknown",
        url: `https://x.com/${this.username}/status/${reply?.id ?? "unknown"}`,
      });
    }

    return results;
  }

  // --- Cleanup ---

  destroy(): void {
    this.rettiwt = null;
  }
}
