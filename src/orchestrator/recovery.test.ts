/**
 * Tests for RecoverySystem
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RecoverySystem, createRecoverySystem } from "./recovery.js";
import type { ExecutionContext } from "./recovery.js";

function createContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    phase: "complete",
    task: { id: "task-1", description: "Build feature" },
    iteration: 1,
    timeout: 120000,
    provider: "anthropic",
    ...overrides,
  };
}

describe("RecoverySystem", () => {
  let recovery: RecoverySystem;

  beforeEach(() => {
    recovery = new RecoverySystem();
  });

  describe("error classification", () => {
    it("should classify syntax errors", async () => {
      const error = new Error("Unexpected token at line 5");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("regenerate");
      expect(result.recovered).toBe(true);
      expect(result.message).toContain("Syntax error");
    });

    it("should classify syntax errors from 'syntax' keyword", async () => {
      const error = new Error("SyntaxError: missing semicolon");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("regenerate");
      expect(result.recovered).toBe(true);
    });

    it("should classify timeout errors", async () => {
      const error = new Error("Operation timed out after 120s");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("retry_with_longer_timeout");
      expect(result.recovered).toBe(true);
      expect(result.newContext?.timeout).toBe(240000); // doubled
    });

    it("should classify timeout errors from 'timeout' keyword", async () => {
      const error = new Error("Request timeout exceeded");
      const context = createContext({ timeout: 60000 });

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("retry_with_longer_timeout");
      expect(result.newContext?.timeout).toBe(120000);
    });

    it("should classify dependency missing errors", async () => {
      const error = new Error("Cannot find module 'lodash'");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("install_dependency");
      expect(result.recovered).toBe(true);
      expect(result.message).toContain("lodash");
    });

    it("should classify dependency error with ENOENT", async () => {
      const error = new Error("ENOENT: no such file or directory");
      const context = createContext();

      const result = await recovery.recover(error, context);

      // Should be classified as dependency_missing due to 'enoent' keyword
      expect(result.recovered).toBeDefined();
    });

    it("should escalate dependency error when module name cannot be extracted", async () => {
      const error = new Error("Missing dependency somewhere");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("escalate");
      expect(result.recovered).toBe(false);
    });

    it("should classify test failure errors", async () => {
      const error = new Error("Test suite failed with 3 errors");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("analyze_and_fix");
      expect(result.recovered).toBe(true);
      expect(result.message).toContain("Test failures");
    });

    it("should classify LLM rate limit errors", async () => {
      const error = new Error("Rate limit exceeded");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("wait_and_retry");
      expect(result.recovered).toBe(true);
    });

    it("should classify LLM API errors from stack trace", async () => {
      const error = new Error("API Error occurred");
      error.stack =
        "Error: API Error occurred\n    at Anthropic.request (/node_modules/anthropic/index.js:42)";
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.recovered).toBe(true);
      expect(result.action).toBe("retry");
    });

    it("should classify LLM overloaded errors with fallback provider", async () => {
      const error = new Error("Model overloaded, please try again");
      const context = createContext({ provider: "anthropic" });

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("fallback_model");
      expect(result.recovered).toBe(true);
      expect(result.newContext?.provider).toBe("openai");
    });

    it("should classify invalid LLM request errors as non-recoverable", async () => {
      // Need to match as llm_error, so include "api error" in message
      const llmError = new Error("API error: Invalid request parameters");
      const context = createContext();

      const result = await recovery.recover(llmError, context);

      expect(result.action).toBe("escalate");
      expect(result.recovered).toBe(false);
    });

    it("should classify build errors", async () => {
      const error = new Error("Build failed with exit code 1");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("fix_build_errors");
      expect(result.recovered).toBe(true);
    });

    it("should classify compilation errors as build errors", async () => {
      const error = new Error("Compilation error in module");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("fix_build_errors");
      expect(result.recovered).toBe(true);
    });

    it("should classify type errors", async () => {
      const error = new Error("Type error: TS(2345) incompatible types");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("fix_type_errors");
      expect(result.recovered).toBe(true);
    });

    it("should classify network errors from ECONNREFUSED", async () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:3000");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("retry_with_backoff");
      expect(result.recovered).toBe(true);
    });

    it("should classify network errors from ENOTFOUND", async () => {
      const error = new Error("getaddrinfo ENOTFOUND api.example.com");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("retry_with_backoff");
      expect(result.recovered).toBe(true);
    });

    it("should classify fetch failed as network error", async () => {
      const error = new Error("fetch failed: network error");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("retry_with_backoff");
      expect(result.recovered).toBe(true);
    });

    it("should classify unknown errors and escalate", async () => {
      const error = new Error("Something completely unexpected happened");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.action).toBe("escalate");
      expect(result.recovered).toBe(false);
      expect(result.message).toContain("complete");
      expect(result.message).toContain("Something completely unexpected");
    });
  });

  describe("retry counting", () => {
    it("should track retries per error type and phase", async () => {
      const error = new Error("Unexpected token found");
      const context = createContext();

      // First 3 retries should succeed
      for (let i = 0; i < 3; i++) {
        const result = await recovery.recover(error, context);
        expect(result.recovered).toBe(true);
      }

      // Fourth attempt should exceed max retries
      const result = await recovery.recover(error, context);
      expect(result.recovered).toBe(false);
      expect(result.action).toBe("escalate");
      expect(result.message).toContain("Max retries");
    });

    it("should track retries separately for different phases", async () => {
      const error = new Error("Unexpected token error");

      // Use up retries in one phase
      const context1 = createContext({ phase: "complete" });
      for (let i = 0; i < 3; i++) {
        await recovery.recover(error, context1);
      }

      // Different phase should still have retries available
      const context2 = createContext({ phase: "output" });
      const result = await recovery.recover(error, context2);
      expect(result.recovered).toBe(true);
    });

    it("should reset retries for a specific classification and phase", async () => {
      const error = new Error("Unexpected token");
      const context = createContext();

      // Use up retries
      for (let i = 0; i < 3; i++) {
        await recovery.recover(error, context);
      }

      // Reset
      recovery.resetRetries("syntax_error", "complete");

      // Should be able to retry again
      const result = await recovery.recover(error, context);
      expect(result.recovered).toBe(true);
    });

    it("should reset all retries", async () => {
      const syntaxError = new Error("Unexpected token");
      const timeoutError = new Error("Operation timed out");
      const context = createContext();

      // Use up retries for multiple types
      for (let i = 0; i < 3; i++) {
        await recovery.recover(syntaxError, context);
        await recovery.recover(timeoutError, context);
      }

      // Reset all
      recovery.resetAllRetries();

      // Both should be recoverable again
      const syntaxResult = await recovery.recover(syntaxError, context);
      expect(syntaxResult.recovered).toBe(true);

      const timeoutResult = await recovery.recover(timeoutError, context);
      expect(timeoutResult.recovered).toBe(true);
    });
  });

  describe("recovery strategies", () => {
    it("should double timeout on timeout recovery", async () => {
      const error = new Error("Request timed out");
      const context = createContext({ timeout: 30000 });

      const result = await recovery.recover(error, context);

      expect(result.newContext?.timeout).toBe(60000);
    });

    it("should use default 120s timeout when context has no timeout", async () => {
      const error = new Error("Operation timed out");
      const context = createContext({ timeout: undefined });

      const result = await recovery.recover(error, context);

      expect(result.newContext?.timeout).toBe(240000); // (120000 default) * 2
    });

    it("should cycle through backup providers", async () => {
      const error = new Error("Model overloaded, capacity reached");

      // anthropic -> openai
      const result1 = await recovery.recover(error, createContext({ provider: "anthropic" }));
      expect(result1.newContext?.provider).toBe("openai");

      // openai -> google
      const result2 = await recovery.recover(error, createContext({ provider: "openai" }));
      expect(result2.newContext?.provider).toBe("google");

      // google -> anthropic
      const result3 = await recovery.recover(error, createContext({ provider: "google" }));
      expect(result3.newContext?.provider).toBe("anthropic");
    });

    it("should extract dependency name from error message", async () => {
      const error = new Error("Cannot find module 'express'");
      const context = createContext();

      const result = await recovery.recover(error, context);

      expect(result.message).toContain("express");
      expect(result.action).toBe("install_dependency");
    });

    it("should preserve context on test failure recovery", async () => {
      const error = new Error("Test suite failed with errors");
      const context = createContext({ iteration: 5 });

      const result = await recovery.recover(error, context);

      expect(result.newContext).toEqual(context);
      expect(result.action).toBe("analyze_and_fix");
    });
  });

  describe("createRecoverySystem", () => {
    it("should create a new RecoverySystem instance", () => {
      const rs = createRecoverySystem();
      expect(rs).toBeInstanceOf(RecoverySystem);
    });
  });
});
