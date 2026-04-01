/**
 * LinkedIn comment monitor — polls tracked posts for new comments
 * and forwards them as MCP notifications to Discord.
 *
 * Uses SQLite for persistence (tracked posts + seen comments).
 * Runs on a configurable interval (default 5 min).
 */

import { Database } from "bun:sqlite";

import type { LinkedInClient } from "./api.ts";

// --- Constants ---

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TRACKED_POSTS = 50;

// --- Types ---

export interface TrackedPost {
  postUrn: string;
  text: string;
  postedAt: string;
  lastChecked: string | null;
  commentCount: number;
}

export interface NewComment {
  postUrn: string;
  postText: string;
  commentUrn: string;
  authorName: string;
  text: string;
}

// --- Monitor ---

export class LinkedInMonitor {
  private db: Database;
  private client: LinkedInClient;
  private pollTimer: Timer | null = null;
  private onNewComments: ((comments: NewComment[]) => void) | null = null;

  constructor(dbPath: string, client: LinkedInClient) {
    this.db = new Database(dbPath);
    this.client = client;
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS linkedin_posts (
        post_urn TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        posted_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_checked TEXT,
        comment_count INTEGER DEFAULT 0
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS linkedin_seen_comments (
        comment_urn TEXT PRIMARY KEY,
        post_urn TEXT NOT NULL,
        author_name TEXT,
        text TEXT,
        seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Track a post for comment monitoring.
   * Called automatically when a post is created.
   */
  trackPost(postUrn: string, text: string): void {
    if (!postUrn) return;

    // Enforce max tracked posts — remove oldest
    const count = this.db.query("SELECT COUNT(*) as c FROM linkedin_posts").get() as { c: number };
    if (count.c >= MAX_TRACKED_POSTS) {
      this.db.run(
        "DELETE FROM linkedin_posts WHERE post_urn = (SELECT post_urn FROM linkedin_posts ORDER BY posted_at ASC LIMIT 1)"
      );
    }

    this.db.run(
      "INSERT OR REPLACE INTO linkedin_posts (post_urn, text) VALUES (?, ?)",
      [postUrn, text.slice(0, 200)]
    );
  }

  /**
   * Remove a post from tracking (e.g. when deleted).
   */
  untrackPost(postUrn: string): void {
    this.db.run("DELETE FROM linkedin_posts WHERE post_urn = ?", [postUrn]);
    this.db.run("DELETE FROM linkedin_seen_comments WHERE post_urn = ?", [postUrn]);
  }

  /**
   * Get all tracked posts.
   */
  getTrackedPosts(): TrackedPost[] {
    return this.db.query(
      "SELECT post_urn as postUrn, text, posted_at as postedAt, last_checked as lastChecked, comment_count as commentCount FROM linkedin_posts ORDER BY posted_at DESC"
    ).all() as TrackedPost[];
  }

  /**
   * Set callback for when new comments are found.
   */
  onComments(callback: (comments: NewComment[]) => void): void {
    this.onNewComments = callback;
  }

  /**
   * Start polling for new comments.
   */
  startPolling(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
    this.stopPolling();
    // Do an initial check after 30s (let things settle)
    this.pollTimer = setTimeout(() => {
      this.pollOnce();
      // Then set up recurring interval
      this.pollTimer = setInterval(() => this.pollOnce(), intervalMs);
    }, 30_000);
  }

  /**
   * Stop polling.
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Poll all tracked posts for new comments.
   */
  async pollOnce(): Promise<NewComment[]> {
    if (!this.client.isAuthenticated()) return [];

    const posts = this.getTrackedPosts();
    const allNew: NewComment[] = [];

    for (const post of posts) {
      try {
        const comments = await this.client.getComments(post.postUrn);

        // Check which are new
        const newComments: NewComment[] = [];
        for (const comment of comments) {
          if (!comment.commentUrn) continue;

          const seen = this.db.query(
            "SELECT 1 FROM linkedin_seen_comments WHERE comment_urn = ?"
          ).get(comment.commentUrn);

          if (!seen) {
            // Mark as seen
            this.db.run(
              "INSERT OR IGNORE INTO linkedin_seen_comments (comment_urn, post_urn, author_name, text) VALUES (?, ?, ?, ?)",
              [comment.commentUrn, post.postUrn, comment.authorName, comment.text.slice(0, 500)]
            );
            newComments.push({
              postUrn: post.postUrn,
              postText: post.text,
              commentUrn: comment.commentUrn,
              authorName: comment.authorName,
              text: comment.text,
            });
          }
        }

        // Update post stats
        this.db.run(
          "UPDATE linkedin_posts SET last_checked = datetime('now'), comment_count = ? WHERE post_urn = ?",
          [comments.length, post.postUrn]
        );

        allNew.push(...newComments);
      } catch (e: any) {
        console.error(`[LinkedIn Monitor] Failed to poll ${post.postUrn}: ${e.message}`);
      }
    }

    // Notify if any new comments found
    if (allNew.length > 0 && this.onNewComments) {
      this.onNewComments(allNew);
    }

    return allNew;
  }

  /**
   * Cleanup — stop polling and close DB.
   */
  destroy(): void {
    this.stopPolling();
    this.db.close();
  }
}
