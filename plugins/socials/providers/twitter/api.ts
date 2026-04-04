/**
 * Twitter/X API provider — posting via X API v2 Free tier.
 *
 * OAuth 2.0 Authorization Code Flow with PKCE.
 * Callback server on port 9877 (one above LinkedIn's 9876).
 * Access tokens expire in 2 hours — auto-refreshed via refresh token (6 months).
 * Uses raw fetch against X API v2 (no library needed).
 *
 * Free tier limits: 500 tweets/month, 85 media uploads/day.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

// --- Constants ---

const X_AUTH_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_API_BASE = "https://api.x.com/2";
const X_UPLOAD_BASE = "https://api.x.com/2/media/upload";
const CALLBACK_PORT = 9877;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

// Token refresh buffer — refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// --- Types ---

export interface TwitterTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  userId?: string;
  username?: string;
}

export interface TweetResult {
  id: string;
  text: string;
  url?: string;
}

interface PendingAuth {
  state: string;
  codeVerifier: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  server?: ReturnType<typeof Bun.serve>;
  timeout?: Timer;
}

// --- PKCE Helpers ---

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// --- Twitter Client ---

export class TwitterClient {
  private tokensPath: string;
  private tokens: TwitterTokens | null = null;
  private pendingAuth: PendingAuth | null = null;
  private clientId: string;

  constructor(dataDir: string, clientId: string) {
    const socialsDir = `${dataDir}/socials`;
    if (!existsSync(socialsDir)) {
      mkdirSync(socialsDir, { recursive: true });
    }
    this.tokensPath = `${socialsDir}/twitter-tokens.json`;
    this.clientId = clientId;
    this.loadTokens();
  }

  // --- Token Management ---

  private loadTokens(): void {
    try {
      const raw = readFileSync(this.tokensPath, "utf-8");
      this.tokens = JSON.parse(raw) as TwitterTokens;
    } catch {
      this.tokens = null;
    }
  }

  private saveTokens(): void {
    if (!this.tokens) return;
    writeFileSync(this.tokensPath, JSON.stringify(this.tokens, null, 2));
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && this.tokens.accessToken !== "";
  }

  getStatus(): {
    authenticated: boolean;
    username?: string;
    userId?: string;
    expiresAt?: number;
  } {
    if (!this.tokens) return { authenticated: false };
    return {
      authenticated: true,
      username: this.tokens.username,
      userId: this.tokens.userId,
      expiresAt: this.tokens.expiresAt,
    };
  }

  private async ensureToken(): Promise<string> {
    if (!this.tokens) throw new Error("Not authenticated. Run twitter_auth first.");

    const now = Date.now();

    // Token still valid
    if (now < this.tokens.expiresAt - REFRESH_BUFFER_MS) {
      return this.tokens.accessToken;
    }

    // Refresh
    if (this.tokens.refreshToken) {
      await this.refreshAccessToken();
      return this.tokens.accessToken;
    }

    throw new Error("Twitter access token expired and no refresh token. Run twitter_auth again.");
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error("No refresh token available.");
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.tokens.refreshToken,
      client_id: this.clientId,
    });

    const resp = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      token_type: string;
    };

    const now = Date.now();
    this.tokens!.accessToken = data.access_token;
    this.tokens!.expiresAt = now + data.expires_in * 1000;
    if (data.refresh_token) {
      this.tokens!.refreshToken = data.refresh_token;
    }
    this.saveTokens();
  }

  // --- OAuth 2.0 PKCE Flow ---

  async startAuth(): Promise<{ authUrl: string; port: number }> {
    this.cleanupPendingAuth();

    const state = randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    let resolveAuth: (code: string) => void;
    let rejectAuth: (err: Error) => void;

    const authPromise = new Promise<string>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });

    this.pendingAuth = {
      state,
      codeVerifier,
      resolve: resolveAuth!,
      reject: rejectAuth!,
    };

    // Start callback server
    const pending = this.pendingAuth;
    const server = Bun.serve({
      port: CALLBACK_PORT,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          pending.reject(new Error(`Auth denied: ${error}`));
          return new Response(
            "<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (!code || returnedState !== pending.state) {
          pending.reject(new Error("Invalid callback — state mismatch or missing code"));
          return new Response("Invalid callback", { status: 400 });
        }

        pending.resolve(code);
        return new Response(
          "<html><body><h2>Connected to X!</h2><p>You can close this tab.</p></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      },
    });

    this.pendingAuth.server = server;

    // Timeout after 5 minutes
    this.pendingAuth.timeout = setTimeout(() => {
      rejectAuth!(new Error("Auth timed out after 5 minutes"));
      this.cleanupPendingAuth();
    }, 5 * 60 * 1000);

    // Wait for callback in background, then exchange code
    authPromise
      .then(async (code) => {
        await this.exchangeCode(code, codeVerifier);
        this.cleanupPendingAuth();
      })
      .catch(() => {
        this.cleanupPendingAuth();
      });

    // Build auth URL
    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: CALLBACK_URL,
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${X_AUTH_URL}?${authParams.toString()}`;

    return { authUrl, port: CALLBACK_PORT };
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<void> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK_URL,
      client_id: this.clientId,
      code_verifier: codeVerifier,
    });

    const resp = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Token exchange failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    const now = Date.now();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + data.expires_in * 1000,
    };

    // Fetch user info
    await this.fetchUserInfo();
    this.saveTokens();
  }

  private async fetchUserInfo(): Promise<void> {
    if (!this.tokens) return;

    try {
      const resp = await fetch(`${X_API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      });

      if (resp.ok) {
        const data = (await resp.json()) as { data: { id: string; username: string; name: string } };
        this.tokens.userId = data.data.id;
        this.tokens.username = data.data.username;
      }
    } catch {
      // Non-fatal — we can post without knowing the username
    }
  }

  private cleanupPendingAuth(): void {
    if (!this.pendingAuth) return;
    if (this.pendingAuth.timeout) clearTimeout(this.pendingAuth.timeout);
    if (this.pendingAuth.server) this.pendingAuth.server.stop();
    this.pendingAuth = null;
  }

  // --- Posting ---

  async postTweet(text: string, replyToId?: string): Promise<TweetResult> {
    const token = await this.ensureToken();

    const body: Record<string, unknown> = { text };
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }

    const resp = await fetch(`${X_API_BASE}/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Tweet failed (${resp.status}): ${errBody}`);
    }

    const data = (await resp.json()) as { data: { id: string; text: string } };
    const username = this.tokens?.username ?? "user";

    return {
      id: data.data.id,
      text: data.data.text,
      url: `https://x.com/${username}/status/${data.data.id}`,
    };
  }

  async postTweetWithMedia(
    text: string,
    mediaPath: string,
  ): Promise<TweetResult> {
    const token = await this.ensureToken();

    // Step 1: Upload media
    const mediaId = await this.uploadMedia(mediaPath, token);

    // Step 2: Post tweet with media
    const resp = await fetch(`${X_API_BASE}/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        media: { media_ids: [mediaId] },
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Tweet with media failed (${resp.status}): ${errBody}`);
    }

    const data = (await resp.json()) as { data: { id: string; text: string } };
    const username = this.tokens?.username ?? "user";

    return {
      id: data.data.id,
      text: data.data.text,
      url: `https://x.com/${username}/status/${data.data.id}`,
    };
  }

  private async uploadMedia(filePath: string, token: string): Promise<string> {
    // Read file
    const fileData = readFileSync(filePath);
    const mimeType = filePath.endsWith(".png")
      ? "image/png"
      : filePath.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

    // Simple upload (for images < 5MB)
    const formData = new FormData();
    formData.append("media", new Blob([fileData], { type: mimeType }), filePath.split("/").pop());
    formData.append("media_category", "tweet_image");

    const resp = await fetch(X_UPLOAD_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Media upload failed (${resp.status}): ${errBody}`);
    }

    const data = (await resp.json()) as { id: string };
    return data.id;
  }

  async postThread(tweets: string[]): Promise<TweetResult[]> {
    if (tweets.length === 0) throw new Error("Thread must have at least one tweet");

    const results: TweetResult[] = [];
    let replyToId: string | undefined;

    for (const tweetText of tweets) {
      const result = await this.postTweet(tweetText, replyToId);
      results.push(result);
      replyToId = result.id;
    }

    return results;
  }

  // --- Cleanup ---

  destroy(): void {
    this.cleanupPendingAuth();
  }
}
