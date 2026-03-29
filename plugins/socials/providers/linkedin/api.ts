/**
 * LinkedIn API provider — personal profile posting via "Share on LinkedIn" product.
 *
 * OAuth 2.0 with PKCE for authorization.
 * Tokens stored as JSON file in the plugin data directory.
 * Uses raw fetch against LinkedIn REST API (no library needed).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

// --- Constants ---

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";
const LINKEDIN_REST_BASE = "https://api.linkedin.com/rest";
const LINKEDIN_VERSION = "202401";
const SCOPES = ["openid", "profile", "w_member_social"];

// Token refresh buffer — refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// --- Types ---

export interface LinkedInTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix ms
  refreshExpiresAt?: number; // Unix ms
  personUrn?: string; // urn:li:person:{id}
  name?: string;
}

export interface LinkedInProfile {
  sub: string; // person ID
  name: string;
  email?: string;
  picture?: string;
}

export interface LinkedInPostResult {
  id: string;
  url?: string;
}

interface PendingAuth {
  codeVerifier: string;
  state: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  server?: ReturnType<typeof Bun.serve>;
  timeout?: Timer;
}

// --- LinkedIn Client ---

export class LinkedInClient {
  private tokensPath: string;
  private tokens: LinkedInTokens | null = null;
  private pendingAuth: PendingAuth | null = null;
  private clientId: string;
  private clientSecret: string;

  constructor(dataDir: string, clientId: string, clientSecret: string) {
    const socialsDir = `${dataDir}/socials`;
    if (!existsSync(socialsDir)) {
      mkdirSync(socialsDir, { recursive: true });
    }
    this.tokensPath = `${socialsDir}/linkedin-tokens.json`;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.loadTokens();
  }

  // --- Token Management ---

  private loadTokens(): void {
    try {
      const raw = readFileSync(this.tokensPath, "utf-8");
      this.tokens = JSON.parse(raw) as LinkedInTokens;
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
    name?: string;
    personUrn?: string;
    expiresAt?: number;
  } {
    if (!this.tokens) return { authenticated: false };
    return {
      authenticated: true,
      name: this.tokens.name,
      personUrn: this.tokens.personUrn,
      expiresAt: this.tokens.expiresAt,
    };
  }

  /**
   * Ensure access token is valid, refreshing if needed.
   * Returns the current access token or throws.
   */
  private async ensureToken(): Promise<string> {
    if (!this.tokens) throw new Error("Not authenticated. Run linkedin_auth first.");

    const now = Date.now();

    // Token still valid
    if (now < this.tokens.expiresAt - REFRESH_BUFFER_MS) {
      return this.tokens.accessToken;
    }

    // Try refresh
    if (this.tokens.refreshToken) {
      const refreshExpired =
        this.tokens.refreshExpiresAt && now >= this.tokens.refreshExpiresAt;
      if (!refreshExpired) {
        await this.refreshAccessToken();
        return this.tokens.accessToken;
      }
    }

    throw new Error(
      "LinkedIn access token expired and no valid refresh token. Run linkedin_auth again."
    );
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error("No refresh token available.");
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.tokens.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const resp = await fetch(LINKEDIN_TOKEN_URL, {
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
      refresh_token_expires_in?: number;
    };

    const now = Date.now();
    this.tokens.accessToken = data.access_token;
    this.tokens.expiresAt = now + data.expires_in * 1000;
    if (data.refresh_token) {
      this.tokens.refreshToken = data.refresh_token;
      this.tokens.refreshExpiresAt = data.refresh_token_expires_in
        ? now + data.refresh_token_expires_in * 1000
        : undefined;
    }
    this.saveTokens();
  }

  // --- OAuth Flow ---

  /**
   * Start OAuth 2.0 + PKCE flow.
   * Spins up a temporary HTTP server on a random port to catch the callback.
   * Returns the authorization URL for the user to visit.
   */
  async startAuth(): Promise<{ authUrl: string; port: number }> {
    // Clean up any pending auth
    this.cleanupPendingAuth();

    // Generate PKCE challenge
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const state = randomBytes(16).toString("hex");

    // Create a promise that resolves when we get the callback
    let resolveAuth: (code: string) => void;
    let rejectAuth: (err: Error) => void;
    const authPromise = new Promise<string>((resolve, reject) => {
      resolveAuth = resolve;
      rejectAuth = reject;
    });

    this.pendingAuth = {
      codeVerifier,
      state,
      resolve: resolveAuth!,
      reject: rejectAuth!,
    };

    // Start temporary HTTP server
    const server = Bun.serve({
      port: 0, // Random available port
      fetch: async (req) => {
        const url = new URL(req.url);

        if (url.pathname === "/callback") {
          return this.handleCallback(url);
        }

        return new Response("LinkedIn OAuth callback server", { status: 200 });
      },
    });

    this.pendingAuth.server = server;
    const port = server.port;

    // Set 5-minute timeout for auth flow
    this.pendingAuth.timeout = setTimeout(() => {
      this.cleanupPendingAuth();
    }, 5 * 60 * 1000);

    const redirectUri = `http://localhost:${port}/callback`;

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${LINKEDIN_AUTH_URL}?${params.toString()}`;

    // Wait for callback in background, then exchange code
    authPromise
      .then(async (code) => {
        await this.exchangeCode(code, redirectUri);
      })
      .catch((e) => {
        console.error(`LinkedIn auth failed: ${e.message}`);
      })
      .finally(() => {
        this.cleanupPendingAuth();
      });

    return { authUrl, port };
  }

  private handleCallback(url: URL): Response {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    if (error) {
      this.pendingAuth?.reject(
        new Error(`LinkedIn denied: ${error} — ${errorDesc}`)
      );
      return new Response(
        htmlPage(
          "Authorization Failed",
          `LinkedIn denied the request: ${errorDesc || error}. You can close this tab.`
        ),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    if (!code || !state) {
      this.pendingAuth?.reject(new Error("Missing code or state in callback"));
      return new Response(
        htmlPage("Error", "Missing authorization code. Try again."),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    if (state !== this.pendingAuth?.state) {
      this.pendingAuth?.reject(new Error("State mismatch — possible CSRF"));
      return new Response(
        htmlPage(
          "Security Error",
          "State parameter mismatch. This could be a CSRF attack. Try again."
        ),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    this.pendingAuth?.resolve(code);

    return new Response(
      htmlPage(
        "LinkedIn Connected!",
        "Authorization successful. You can close this tab and return to Discord."
      ),
      { headers: { "Content-Type": "text/html" } }
    );
  }

  private async exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<void> {
    if (!this.pendingAuth) throw new Error("No pending auth flow");

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: this.pendingAuth.codeVerifier,
    });

    const resp = await fetch(LINKEDIN_TOKEN_URL, {
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
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      scope?: string;
    };

    const now = Date.now();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now + data.expires_in * 1000,
      refreshExpiresAt: data.refresh_token_expires_in
        ? now + data.refresh_token_expires_in * 1000
        : undefined,
    };
    this.saveTokens();

    // Fetch profile to get URN + name
    try {
      const profile = await this.getProfile();
      this.tokens.personUrn = `urn:li:person:${profile.sub}`;
      this.tokens.name = profile.name;
      this.saveTokens();
    } catch (e: any) {
      console.error(`Failed to fetch LinkedIn profile: ${e.message}`);
    }
  }

  private cleanupPendingAuth(): void {
    if (!this.pendingAuth) return;

    if (this.pendingAuth.timeout) {
      clearTimeout(this.pendingAuth.timeout);
    }
    if (this.pendingAuth.server) {
      this.pendingAuth.server.stop();
    }
    this.pendingAuth = null;
  }

  // --- API Methods ---

  /**
   * Get the authenticated user's profile via OpenID userinfo endpoint.
   */
  async getProfile(): Promise<LinkedInProfile> {
    const token = await this.ensureToken();

    const resp = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Profile fetch failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      sub: string;
      name: string;
      email?: string;
      picture?: string;
    };

    return {
      sub: data.sub,
      name: data.name,
      email: data.email,
      picture: data.picture,
    };
  }

  /**
   * Create a text post on the authenticated user's personal profile.
   */
  async post(text: string): Promise<LinkedInPostResult> {
    const token = await this.ensureToken();

    // Ensure we have the person URN
    if (!this.tokens?.personUrn) {
      const profile = await this.getProfile();
      this.tokens!.personUrn = `urn:li:person:${profile.sub}`;
      this.tokens!.name = profile.name;
      this.saveTokens();
    }

    const body = {
      author: this.tokens!.personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text,
          },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const resp = await fetch(`${LINKEDIN_API_BASE}/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const respBody = await resp.text();
      throw new Error(`LinkedIn post failed (${resp.status}): ${respBody}`);
    }

    // The post ID comes from the X-RestLi-Id header or response body
    const postId =
      resp.headers.get("x-restli-id") || resp.headers.get("X-RestLi-Id") || "";

    // Construct the post URL
    // UGC post IDs look like "urn:li:share:12345" — extract the numeric part
    const shareId = postId.split(":").pop() || "";
    const profileName = this.tokens?.name?.replace(/\s+/g, "-").toLowerCase();
    const postUrl = shareId
      ? `https://www.linkedin.com/feed/update/${postId}/`
      : undefined;

    return {
      id: postId,
      url: postUrl,
    };
  }

  /**
   * Cleanup — stop any pending auth server.
   */
  destroy(): void {
    this.cleanupPendingAuth();
  }
}

// --- Helpers ---

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
  h1 { color: #0a66c2; margin-bottom: 0.5rem; }
  p { color: #666; }
</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`;
}
