/**
 * Provider-agnostic scheduling types.
 *
 * Discriminated payload union over a `kind` tag — each provider authors its
 * own payload shape, the scheduler stores them as JSON. Adapter (`Poster`)
 * narrows to the matching variant inside `publish()`.
 */

export type Provider = "linkedin" | "twitter" | "reddit";

export type ScheduleStatus = "pending" | "posted" | "cancelled" | "failed";

// --- Provider payloads ---

export interface LinkedInPayload {
  kind: "linkedin";
  text: string;
  mediaType: "text" | "image" | "link";
  imageUrl?: string;
  linkUrl?: string;
  linkTitle?: string;
  linkDescription?: string;
  firstComment?: string;
}

export interface TwitterPayload {
  kind: "twitter";
  variant: "tweet" | "tweetWithMedia" | "thread";
  text?: string;
  imagePath?: string;
  tweets?: string[];
}

export interface RedditPayload {
  kind: "reddit";
  subreddit: string;
  title: string;
  variant: "self" | "link" | "image";
  text?: string;
  url?: string;
  imagePath?: string;
}

export type SchedulePayload = LinkedInPayload | TwitterPayload | RedditPayload;

// --- Generic scheduled row ---

export interface ScheduledPost {
  id: number;
  provider: Provider;
  payload: SchedulePayload;
  scheduledAt: string; // SQLite datetime
  status: ScheduleStatus;
  providerPostId: string | null;
  providerPostUrl: string | null;
  error: string | null;
  createdAt: string;
}

// --- Poster interface ---

export interface PublishResult {
  id: string;
  url?: string;
}

export interface Poster<P extends SchedulePayload = SchedulePayload> {
  /** Whether the underlying client has a usable session/token. */
  isAuthenticated(): boolean;
  /** Publish a payload. Throws on failure. */
  publish(payload: P): Promise<PublishResult>;
}

export type PosterRegistry = Partial<Record<Provider, Poster>>;
