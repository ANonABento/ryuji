import { describe, expect, test } from "bun:test";
import { isAnthropicError } from "../../daemon/session-core.ts";
import { createInitialState } from "../../daemon/lifecycle.ts";
import { ANTHROPIC_FALLBACK_THRESHOLD } from "../../daemon/constants.ts";

describe("daemon model fallback", () => {
  describe("isAnthropicError", () => {
    test("detects rate limit errors", () => {
      expect(isAnthropicError(new Error("429: rate_limit exceeded"))).toBe(true);
      expect(isAnthropicError(new Error("Rate limit exceeded, try again later"))).toBe(true);
      expect(isAnthropicError(new Error("rate_limit_error: you have hit your limit"))).toBe(true);
    });

    test("detects payment and billing errors", () => {
      expect(isAnthropicError(new Error("402: payment required"))).toBe(true);
      expect(isAnthropicError(new Error("Billing issue: credit card declined"))).toBe(true);
      expect(isAnthropicError(new Error("Credit limit exceeded for this month"))).toBe(true);
      expect(isAnthropicError(new Error("quota exceeded: monthly limit reached"))).toBe(true);
    });

    test("detects overloaded errors", () => {
      expect(isAnthropicError(new Error("529: Overloaded"))).toBe(true);
      expect(isAnthropicError(new Error("API is overloaded, please retry"))).toBe(true);
    });

    test("detects authentication errors", () => {
      expect(isAnthropicError(new Error("401: unauthorized"))).toBe(true);
      expect(isAnthropicError(new Error("authentication_error: invalid API key"))).toBe(true);
    });

    test("does not treat generic network errors as Anthropic errors", () => {
      expect(isAnthropicError(new Error("ECONNRESET"))).toBe(false);
      expect(isAnthropicError(new Error("socket hang up"))).toBe(false);
      expect(isAnthropicError(new Error("ETIMEDOUT"))).toBe(false);
      expect(isAnthropicError(new Error("AbortError"))).toBe(false);
      expect(isAnthropicError(new Error("Session stream closed unexpectedly"))).toBe(false);
    });

    test("handles non-Error values", () => {
      expect(isAnthropicError("rate limit exceeded")).toBe(true);
      expect(isAnthropicError("network error")).toBe(false);
      expect(isAnthropicError(null)).toBe(false);
      expect(isAnthropicError(undefined)).toBe(false);
    });
  });

  describe("MetaState initial provider", () => {
    test("starts on anthropic provider", () => {
      const state = createInitialState();
      expect(state.activeProvider).toBe("anthropic");
    });

    test("starts with zero anthropic failure count", () => {
      const state = createInitialState();
      expect(state.anthropicFailureCount).toBe(0);
    });
  });

  describe("fallback threshold", () => {
    test("ANTHROPIC_FALLBACK_THRESHOLD is a positive integer", () => {
      expect(typeof ANTHROPIC_FALLBACK_THRESHOLD).toBe("number");
      expect(ANTHROPIC_FALLBACK_THRESHOLD).toBeGreaterThan(0);
      expect(Number.isInteger(ANTHROPIC_FALLBACK_THRESHOLD)).toBe(true);
    });

    test("simulated fallback: counting errors switches provider", () => {
      const state = createInitialState();
      expect(state.activeProvider).toBe("anthropic");

      const rateLimitError = new Error("429: rate_limit exceeded");

      // Simulate repeated Anthropic failures
      for (let i = 0; i < ANTHROPIC_FALLBACK_THRESHOLD; i++) {
        expect(state.activeProvider).toBe("anthropic");

        if (state.activeProvider === "anthropic" && isAnthropicError(rateLimitError)) {
          state.anthropicFailureCount++;

          if (state.anthropicFailureCount >= ANTHROPIC_FALLBACK_THRESHOLD) {
            state.activeProvider = "ollama";
            state.anthropicFailureCount = 0;
          }
        }
      }

      expect(state.activeProvider).toBe("ollama");
      expect(state.anthropicFailureCount).toBe(0);
    });

    test("non-Anthropic errors do not count toward fallback threshold", () => {
      const state = createInitialState();
      const networkError = new Error("ECONNRESET");

      for (let i = 0; i < ANTHROPIC_FALLBACK_THRESHOLD * 2; i++) {
        if (state.activeProvider === "anthropic" && isAnthropicError(networkError)) {
          state.anthropicFailureCount++;
        }
      }

      expect(state.activeProvider).toBe("anthropic");
      expect(state.anthropicFailureCount).toBe(0);
    });
  });
});
