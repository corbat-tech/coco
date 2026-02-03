/**
 * Error handling for Corbat-Coco
 * Custom error types with context and recovery information
 */

/**
 * Base error class for Corbat-Coco
 */
export class CocoError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly suggestion?: string;

  constructor(
    message: string,
    options: {
      code: string;
      context?: Record<string, unknown>;
      recoverable?: boolean;
      suggestion?: string;
      cause?: Error;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "CocoError";
    this.code = options.code;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
    this.suggestion = options.suggestion;

    // Capture stack trace
    Error.captureStackTrace(this, CocoError);
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
      stack: this.stack,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/**
 * File system error
 */
export class FileSystemError extends CocoError {
  constructor(
    message: string,
    options: {
      path: string;
      operation: "read" | "write" | "delete" | "exists" | "glob";
      cause?: Error;
    }
  ) {
    super(message, {
      code: "FILESYSTEM_ERROR",
      context: { path: options.path, operation: options.operation },
      recoverable: false,
      suggestion: `Check that the path exists and you have permissions: ${options.path}`,
      cause: options.cause,
    });
    this.name = "FileSystemError";
  }
}

/**
 * LLM provider error
 */
export class ProviderError extends CocoError {
  readonly provider: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      provider: string;
      statusCode?: number;
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, {
      code: "PROVIDER_ERROR",
      context: { provider: options.provider, statusCode: options.statusCode },
      recoverable: options.retryable ?? false,
      suggestion: options.retryable
        ? "The request can be retried"
        : "Check your API key and provider configuration",
      cause: options.cause,
    });
    this.name = "ProviderError";
    this.provider = options.provider;
    this.statusCode = options.statusCode;
  }
}

/**
 * Configuration error
 */
export class ConfigError extends CocoError {
  readonly issues: ConfigIssue[];

  constructor(
    message: string,
    options: {
      issues?: ConfigIssue[];
      configPath?: string;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: "CONFIG_ERROR",
      context: { configPath: options.configPath, issues: options.issues },
      recoverable: true,
      suggestion: "Check your .coco/config.json for errors",
      cause: options.cause,
    });
    this.name = "ConfigError";
    this.issues = options.issues ?? [];
  }

  /**
   * Format issues as a readable string
   */
  formatIssues(): string {
    if (this.issues.length === 0) return "";
    return this.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
  }
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/**
 * Validation error
 */
export class ValidationError extends CocoError {
  readonly field?: string;
  readonly issues: ValidationIssue[];

  constructor(
    message: string,
    options: {
      field?: string;
      issues?: ValidationIssue[];
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: "VALIDATION_ERROR",
      context: { field: options.field, issues: options.issues },
      recoverable: true,
      suggestion: "Check the input data format",
      cause: options.cause,
    });
    this.name = "ValidationError";
    this.field = options.field;
    this.issues = options.issues ?? [];
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Phase execution error
 */
export class PhaseError extends CocoError {
  readonly phase: string;

  constructor(
    message: string,
    options: {
      phase: string;
      recoverable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, {
      code: "PHASE_ERROR",
      context: { phase: options.phase },
      recoverable: options.recoverable ?? true,
      suggestion: `Phase '${options.phase}' failed. Try 'coco resume' to continue.`,
      cause: options.cause,
    });
    this.name = "PhaseError";
    this.phase = options.phase;
  }
}

/**
 * Task execution error
 */
export class TaskError extends CocoError {
  readonly taskId: string;
  readonly iteration?: number;

  constructor(
    message: string,
    options: {
      taskId: string;
      iteration?: number;
      recoverable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, {
      code: "TASK_ERROR",
      context: { taskId: options.taskId, iteration: options.iteration },
      recoverable: options.recoverable ?? true,
      suggestion: "The task can be retried from the last checkpoint",
      cause: options.cause,
    });
    this.name = "TaskError";
    this.taskId = options.taskId;
    this.iteration = options.iteration;
  }
}

/**
 * Quality threshold error
 */
export class QualityError extends CocoError {
  readonly score: number;
  readonly threshold: number;
  readonly dimension?: string;

  constructor(
    message: string,
    options: {
      score: number;
      threshold: number;
      dimension?: string;
    }
  ) {
    super(message, {
      code: "QUALITY_ERROR",
      context: {
        score: options.score,
        threshold: options.threshold,
        dimension: options.dimension,
      },
      recoverable: true,
      suggestion: "Review the quality issues and iterate on the code",
    });
    this.name = "QualityError";
    this.score = options.score;
    this.threshold = options.threshold;
    this.dimension = options.dimension;
  }
}

/**
 * Checkpoint/recovery error
 */
export class RecoveryError extends CocoError {
  readonly checkpointId?: string;

  constructor(
    message: string,
    options: {
      checkpointId?: string;
      cause?: Error;
    } = {}
  ) {
    super(message, {
      code: "RECOVERY_ERROR",
      context: { checkpointId: options.checkpointId },
      recoverable: false,
      suggestion: "Try starting fresh with 'coco init --force'",
      cause: options.cause,
    });
    this.name = "RecoveryError";
    this.checkpointId = options.checkpointId;
  }
}

/**
 * Tool execution error
 */
export class ToolError extends CocoError {
  readonly tool: string;

  constructor(
    message: string,
    options: {
      tool: string;
      cause?: Error;
    }
  ) {
    super(message, {
      code: "TOOL_ERROR",
      context: { tool: options.tool },
      recoverable: true,
      suggestion: `Tool '${options.tool}' failed. Check the logs for details.`,
      cause: options.cause,
    });
    this.name = "ToolError";
    this.tool = options.tool;
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends CocoError {
  readonly timeoutMs: number;
  readonly operation: string;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      operation: string;
    }
  ) {
    super(message, {
      code: "TIMEOUT_ERROR",
      context: { timeoutMs: options.timeoutMs, operation: options.operation },
      recoverable: true,
      suggestion: "Try increasing the timeout or simplifying the operation",
    });
    this.name = "TimeoutError";
    this.timeoutMs = options.timeoutMs;
    this.operation = options.operation;
  }
}

/**
 * Check if error is a specific type
 */
export function isCocoError(error: unknown): error is CocoError {
  return error instanceof CocoError;
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof CocoError) {
    let message = `[${error.code}] ${error.message}`;
    if (error.suggestion) {
      message += `\n  Suggestion: ${error.suggestion}`;
    }
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Wrap an async function with error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: { operation: string; recoverable?: boolean }
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CocoError) {
      throw error;
    }

    throw new CocoError(
      error instanceof Error ? error.message : String(error),
      {
        code: "UNEXPECTED_ERROR",
        context: { operation: context.operation },
        recoverable: context.recoverable ?? false,
        cause: error instanceof Error ? error : undefined,
      }
    );
  }
}

/**
 * Retry an async function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const shouldRetry = options.shouldRetry ?? ((error) => {
    if (error instanceof CocoError) {
      return error.recoverable;
    }
    return false;
  });

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError;
}
