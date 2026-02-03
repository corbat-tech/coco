/**
 * Tests for error utilities
 */

import { describe, it, expect } from "vitest";
import {
  CocoError,
  ConfigError,
  FileSystemError,
  ProviderError,
  ValidationError,
  PhaseError,
  TaskError,
  QualityError,
  RecoveryError,
  ToolError,
  TimeoutError,
  isCocoError,
  formatError,
  withRetry,
  withErrorHandling,
} from "./errors.js";

describe("CocoError", () => {
  it("should create error with required properties", () => {
    const error = new CocoError("Test error", {
      code: "TEST_ERROR",
    });

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.recoverable).toBe(false);
    expect(error.context).toEqual({});
  });

  it("should create error with all properties", () => {
    const cause = new Error("Original error");
    const error = new CocoError("Test error", {
      code: "TEST_ERROR",
      context: { key: "value" },
      recoverable: true,
      suggestion: "Try again",
      cause,
    });

    expect(error.code).toBe("TEST_ERROR");
    expect(error.context).toEqual({ key: "value" });
    expect(error.recoverable).toBe(true);
    expect(error.suggestion).toBe("Try again");
    expect(error.cause).toBe(cause);
  });

  it("should serialize to JSON", () => {
    const error = new CocoError("Test error", {
      code: "TEST_ERROR",
      context: { foo: "bar" },
    });

    const json = error.toJSON();

    expect(json.name).toBe("CocoError");
    expect(json.code).toBe("TEST_ERROR");
    expect(json.message).toBe("Test error");
    expect(json.context).toEqual({ foo: "bar" });
  });

  it("should serialize to JSON with cause", () => {
    const cause = new Error("Cause error");
    const error = new CocoError("Test error", {
      code: "TEST_ERROR",
      cause,
    });

    const json = error.toJSON();
    expect(json.cause).toBe("Cause error");
  });

  it("should have correct name property", () => {
    const error = new CocoError("Test", { code: "TEST" });
    expect(error.name).toBe("CocoError");
  });
});

describe("ConfigError", () => {
  it("should create config error with defaults", () => {
    const error = new ConfigError("Invalid config");

    expect(error.name).toBe("ConfigError");
    expect(error.code).toBe("CONFIG_ERROR");
    expect(error.recoverable).toBe(true);
    expect(error.suggestion).toContain("config.json");
  });

  it("should include issues and configPath in context", () => {
    const error = new ConfigError("Invalid value", {
      issues: [{ path: "provider.model", message: "Invalid model" }],
      configPath: "/path/to/config.json",
    });

    expect(error.context.configPath).toBe("/path/to/config.json");
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe("provider.model");
  });

  it("should format issues", () => {
    const error = new ConfigError("Invalid config", {
      issues: [
        { path: "provider.model", message: "Invalid model" },
        { path: "quality.minScore", message: "Must be positive" },
      ],
    });

    const formatted = error.formatIssues();
    expect(formatted).toContain("provider.model");
    expect(formatted).toContain("Invalid model");
    expect(formatted).toContain("quality.minScore");
  });

  it("should accept cause", () => {
    const cause = new Error("Original");
    const error = new ConfigError("Invalid", { cause });
    expect(error.cause).toBe(cause);
  });
});

describe("FileSystemError", () => {
  it("should create filesystem error", () => {
    const error = new FileSystemError("File not found", {
      path: "/path/to/file",
      operation: "read",
    });

    expect(error.name).toBe("FileSystemError");
    expect(error.code).toBe("FILESYSTEM_ERROR");
    expect(error.context.path).toBe("/path/to/file");
    expect(error.context.operation).toBe("read");
  });

  it("should handle different operations", () => {
    const operations = ["read", "write", "delete", "exists", "glob"] as const;
    for (const operation of operations) {
      const error = new FileSystemError("Error", { path: "/test", operation });
      expect(error.context.operation).toBe(operation);
    }
  });

  it("should include path in suggestion", () => {
    const error = new FileSystemError("Error", { path: "/my/path", operation: "read" });
    expect(error.suggestion).toContain("/my/path");
  });
});

describe("ProviderError", () => {
  it("should create provider error", () => {
    const error = new ProviderError("API error", {
      provider: "anthropic",
      statusCode: 429,
      retryable: true,
    });

    expect(error.name).toBe("ProviderError");
    expect(error.provider).toBe("anthropic");
    expect(error.statusCode).toBe(429);
    expect(error.recoverable).toBe(true);
  });

  it("should default to non-retryable", () => {
    const error = new ProviderError("API error", {
      provider: "anthropic",
    });

    expect(error.recoverable).toBe(false);
    expect(error.suggestion).toContain("API key");
  });

  it("should have retry suggestion when retryable", () => {
    const error = new ProviderError("Rate limited", {
      provider: "openai",
      retryable: true,
    });

    expect(error.suggestion).toContain("retried");
  });
});

describe("ValidationError", () => {
  it("should create validation error with issues", () => {
    const error = new ValidationError("Invalid data", {
      issues: [
        { path: "name", message: "Required", code: "required" },
        { path: "age", message: "Must be positive", code: "invalid" },
      ],
    });

    expect(error.name).toBe("ValidationError");
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]?.path).toBe("name");
  });

  it("should default to empty issues", () => {
    const error = new ValidationError("Invalid");
    expect(error.issues).toEqual([]);
  });

  it("should include field in context", () => {
    const error = new ValidationError("Invalid", {
      field: "email",
    });

    expect(error.field).toBe("email");
    expect(error.context.field).toBe("email");
  });
});

describe("PhaseError", () => {
  it("should create phase error", () => {
    const error = new PhaseError("Phase failed", {
      phase: "converge",
    });

    expect(error.name).toBe("PhaseError");
    expect(error.code).toBe("PHASE_ERROR");
    expect(error.phase).toBe("converge");
    expect(error.recoverable).toBe(true);
  });

  it("should include phase name in suggestion", () => {
    const error = new PhaseError("Failed", { phase: "orchestrate" });
    expect(error.suggestion).toContain("orchestrate");
    expect(error.suggestion).toContain("resume");
  });

  it("should allow non-recoverable", () => {
    const error = new PhaseError("Fatal", {
      phase: "complete",
      recoverable: false,
    });
    expect(error.recoverable).toBe(false);
  });
});

describe("TaskError", () => {
  it("should create task error", () => {
    const error = new TaskError("Task failed", {
      taskId: "task-123",
      iteration: 3,
    });

    expect(error.name).toBe("TaskError");
    expect(error.code).toBe("TASK_ERROR");
    expect(error.taskId).toBe("task-123");
    expect(error.iteration).toBe(3);
    expect(error.recoverable).toBe(true);
  });

  it("should default to recoverable", () => {
    const error = new TaskError("Failed", { taskId: "task-1" });
    expect(error.recoverable).toBe(true);
  });

  it("should include iteration in context", () => {
    const error = new TaskError("Failed", { taskId: "task-1", iteration: 5 });
    expect(error.context.iteration).toBe(5);
  });
});

describe("QualityError", () => {
  it("should create quality error", () => {
    const error = new QualityError("Quality too low", {
      score: 65,
      threshold: 85,
      dimension: "coverage",
    });

    expect(error.name).toBe("QualityError");
    expect(error.code).toBe("QUALITY_ERROR");
    expect(error.score).toBe(65);
    expect(error.threshold).toBe(85);
    expect(error.dimension).toBe("coverage");
    expect(error.recoverable).toBe(true);
  });

  it("should work without dimension", () => {
    const error = new QualityError("Low score", {
      score: 50,
      threshold: 80,
    });

    expect(error.dimension).toBeUndefined();
    expect(error.context.dimension).toBeUndefined();
  });
});

describe("RecoveryError", () => {
  it("should create recovery error", () => {
    const error = new RecoveryError("Cannot recover");

    expect(error.name).toBe("RecoveryError");
    expect(error.code).toBe("RECOVERY_ERROR");
    expect(error.recoverable).toBe(false);
  });

  it("should include checkpoint ID", () => {
    const error = new RecoveryError("Failed", {
      checkpointId: "cp-123",
    });

    expect(error.checkpointId).toBe("cp-123");
    expect(error.context.checkpointId).toBe("cp-123");
  });

  it("should suggest fresh start", () => {
    const error = new RecoveryError("Corrupted");
    expect(error.suggestion).toContain("init");
  });
});

describe("ToolError", () => {
  it("should create tool error", () => {
    const error = new ToolError("Tool failed", {
      tool: "bash",
    });

    expect(error.name).toBe("ToolError");
    expect(error.code).toBe("TOOL_ERROR");
    expect(error.tool).toBe("bash");
    expect(error.recoverable).toBe(true);
  });

  it("should include tool name in suggestion", () => {
    const error = new ToolError("Failed", { tool: "git" });
    expect(error.suggestion).toContain("git");
  });
});

describe("TimeoutError", () => {
  it("should create timeout error", () => {
    const error = new TimeoutError("Operation timed out", {
      timeoutMs: 30000,
      operation: "LLM call",
    });

    expect(error.name).toBe("TimeoutError");
    expect(error.code).toBe("TIMEOUT_ERROR");
    expect(error.timeoutMs).toBe(30000);
    expect(error.operation).toBe("LLM call");
    expect(error.recoverable).toBe(true);
  });

  it("should suggest increasing timeout", () => {
    const error = new TimeoutError("Timeout", { timeoutMs: 5000, operation: "test" });
    expect(error.suggestion).toContain("timeout");
  });
});

describe("isCocoError", () => {
  it("should return true for CocoError instances", () => {
    const error = new CocoError("Test", { code: "TEST" });
    expect(isCocoError(error)).toBe(true);
  });

  it("should return true for subclasses", () => {
    const error = new ConfigError("Test");
    expect(isCocoError(error)).toBe(true);
  });

  it("should return true for all error subclasses", () => {
    expect(isCocoError(new FileSystemError("Test", { path: "/", operation: "read" }))).toBe(true);
    expect(isCocoError(new ProviderError("Test", { provider: "test" }))).toBe(true);
    expect(isCocoError(new ValidationError("Test"))).toBe(true);
    expect(isCocoError(new PhaseError("Test", { phase: "test" }))).toBe(true);
    expect(isCocoError(new TaskError("Test", { taskId: "test" }))).toBe(true);
    expect(isCocoError(new QualityError("Test", { score: 50, threshold: 80 }))).toBe(true);
    expect(isCocoError(new RecoveryError("Test"))).toBe(true);
    expect(isCocoError(new ToolError("Test", { tool: "test" }))).toBe(true);
    expect(isCocoError(new TimeoutError("Test", { timeoutMs: 1000, operation: "test" }))).toBe(true);
  });

  it("should return false for regular errors", () => {
    const error = new Error("Test");
    expect(isCocoError(error)).toBe(false);
  });

  it("should return false for non-errors", () => {
    expect(isCocoError("string")).toBe(false);
    expect(isCocoError(null)).toBe(false);
    expect(isCocoError(undefined)).toBe(false);
  });
});

describe("formatError", () => {
  it("should format CocoError with suggestion", () => {
    const error = new CocoError("Test error", {
      code: "TEST_ERROR",
      suggestion: "Try this",
    });

    const formatted = formatError(error);

    expect(formatted).toContain("[TEST_ERROR]");
    expect(formatted).toContain("Test error");
    expect(formatted).toContain("Try this");
  });

  it("should format CocoError without suggestion", () => {
    const error = new CocoError("Test error", { code: "TEST_ERROR" });
    const formatted = formatError(error);

    expect(formatted).toContain("[TEST_ERROR]");
    expect(formatted).toContain("Test error");
    expect(formatted).not.toContain("Suggestion");
  });

  it("should format regular Error", () => {
    const error = new Error("Regular error");
    expect(formatError(error)).toBe("Regular error");
  });

  it("should format non-error values", () => {
    expect(formatError("string error")).toBe("string error");
    expect(formatError(123)).toBe("123");
  });
});

describe("withErrorHandling", () => {
  it("should return result on success", async () => {
    const fn = async () => "success";
    const result = await withErrorHandling(fn, { operation: "test" });
    expect(result).toBe("success");
  });

  it("should pass through CocoError", async () => {
    const originalError = new ConfigError("Config issue");
    const fn = async () => {
      throw originalError;
    };

    await expect(withErrorHandling(fn, { operation: "test" })).rejects.toBe(originalError);
  });

  it("should wrap regular Error", async () => {
    const fn = async () => {
      throw new Error("Regular error");
    };

    await expect(withErrorHandling(fn, { operation: "test" })).rejects.toThrow(CocoError);
  });

  it("should include operation in context", async () => {
    const fn = async () => {
      throw new Error("Failed");
    };

    try {
      await withErrorHandling(fn, { operation: "my-operation" });
    } catch (error) {
      expect(isCocoError(error)).toBe(true);
      expect((error as CocoError).context.operation).toBe("my-operation");
    }
  });

  it("should respect recoverable option", async () => {
    const fn = async () => {
      throw new Error("Failed");
    };

    try {
      await withErrorHandling(fn, { operation: "test", recoverable: true });
    } catch (error) {
      expect((error as CocoError).recoverable).toBe(true);
    }
  });

  it("should wrap non-error values", async () => {
    const fn = async () => {
      throw "string error";
    };

    try {
      await withErrorHandling(fn, { operation: "test" });
    } catch (error) {
      expect(isCocoError(error)).toBe(true);
      expect((error as CocoError).message).toBe("string error");
    }
  });
});

describe("withRetry", () => {
  it("should return result on first success", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "success";
    };

    const result = await withRetry(fn);

    expect(result).toBe("success");
    expect(calls).toBe(1);
  });

  it("should retry on failure", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) {
        throw new CocoError("Retry me", { code: "RETRY", recoverable: true });
      }
      return "success";
    };

    const result = await withRetry(fn, { initialDelayMs: 10 });

    expect(result).toBe("success");
    expect(calls).toBe(3);
  });

  it("should throw after max attempts", async () => {
    const fn = async () => {
      throw new CocoError("Always fail", { code: "FAIL", recoverable: true });
    };

    await expect(withRetry(fn, { maxAttempts: 2, initialDelayMs: 10 }))
      .rejects.toThrow("Always fail");
  });

  it("should not retry non-recoverable errors", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new CocoError("Non-recoverable", { code: "FAIL", recoverable: false });
    };

    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 }))
      .rejects.toThrow("Non-recoverable");
    expect(calls).toBe(1);
  });

  it("should use custom shouldRetry function", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("Custom error");
    };

    await expect(withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      shouldRetry: () => true,
    })).rejects.toThrow("Custom error");

    expect(calls).toBe(3);
  });

  it("should respect maxDelayMs", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 4) {
        throw new CocoError("Retry", { code: "RETRY", recoverable: true });
      }
      return "success";
    };

    const result = await withRetry(fn, {
      initialDelayMs: 10,
      maxDelayMs: 20,
      maxAttempts: 4,
    });

    expect(result).toBe("success");
    expect(calls).toBe(4);
  });

  it("should not retry regular errors by default", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("Regular");
    };

    await expect(withRetry(fn, { maxAttempts: 3, initialDelayMs: 10 }))
      .rejects.toThrow("Regular");
    expect(calls).toBe(1);
  });
});
