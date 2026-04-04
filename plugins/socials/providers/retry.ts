/**
 * Retry utility for social media posting.
 *
 * Exponential backoff with configurable attempts.
 * Inspired by Post4U's per-platform retry pattern.
 */

export interface RetryOptions {
  /** Max attempts (default 3) */
  maxAttempts?: number;
  /** Base delay in ms (default 3000 = 3s) */
  baseDelayMs?: number;
  /** Multiplier for each retry (default 2 = exponential) */
  backoffMultiplier?: number;
  /** Optional label for logging */
  label?: string;
}

/**
 * Retry a function with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the first successful call
 * @throws The last error if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 3000,
    backoffMultiplier = 2,
    label = "operation",
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        console.error(
          `[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${e.message}. Retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after ${maxAttempts} attempts`);
}
