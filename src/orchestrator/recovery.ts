/**
 * Recovery System
 * Handles errors and recovery strategies during code generation
 */

export type ErrorClassification =
  | "syntax_error"
  | "timeout"
  | "dependency_missing"
  | "test_failure"
  | "llm_error"
  | "build_error"
  | "type_error"
  | "network_error"
  | "unknown";

export interface ExecutionContext {
  phase: string;
  task?: any;
  files?: any[];
  iteration?: number;
  timeout?: number;
  provider?: string;
}

export interface RecoveryResult {
  recovered: boolean;
  action: string;
  newContext?: ExecutionContext;
  message: string;
}

/**
 * Recovery System
 */
export class RecoverySystem {
  private maxRetries = 3;
  private retryCount = new Map<string, number>();

  /**
   * Recover from an error
   */
  async recover(error: Error, context: ExecutionContext): Promise<RecoveryResult> {
    // Classify error
    const classification = this.classifyError(error);

    console.warn(`[Recovery] Attempting recovery from ${classification}: ${error.message}`);

    // Check if we've exceeded max retries for this error type
    const key = `${classification}-${context.phase}`;
    const retries = this.retryCount.get(key) || 0;

    if (retries >= this.maxRetries) {
      return {
        recovered: false,
        action: "escalate",
        message: `Max retries (${this.maxRetries}) exceeded for ${classification}. Manual intervention required.`,
      };
    }

    this.retryCount.set(key, retries + 1);

    // Apply recovery strategy based on error type
    switch (classification) {
      case "syntax_error":
        return this.recoverFromSyntaxError(error, context);

      case "timeout":
        return this.recoverFromTimeout(error, context);

      case "dependency_missing":
        return this.recoverFromDependencyError(error, context);

      case "test_failure":
        return this.recoverFromTestFailure(error, context);

      case "llm_error":
        return this.recoverFromLLMError(error, context);

      case "build_error":
        return this.recoverFromBuildError(error, context);

      case "type_error":
        return this.recoverFromTypeError(error, context);

      case "network_error":
        return this.recoverFromNetworkError(error, context);

      default:
        return this.escalateToUser(error, context);
    }
  }

  /**
   * Classify error type
   */
  private classifyError(error: Error): ErrorClassification {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || "";

    if (message.includes("syntax") || message.includes("unexpected token")) {
      return "syntax_error";
    }

    if (message.includes("timeout") || message.includes("timed out")) {
      return "timeout";
    }

    if (
      message.includes("cannot find module") ||
      message.includes("missing dependency") ||
      message.includes("enoent")
    ) {
      return "dependency_missing";
    }

    if (message.includes("test") && (message.includes("failed") || message.includes("error"))) {
      return "test_failure";
    }

    if (
      message.includes("rate limit") ||
      message.includes("api error") ||
      message.includes("model error") ||
      stack.includes("anthropic") ||
      stack.includes("openai")
    ) {
      return "llm_error";
    }

    if (message.includes("build failed") || message.includes("compilation error")) {
      return "build_error";
    }

    if (message.includes("type error") || message.includes("ts(")) {
      return "type_error";
    }

    if (
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("fetch failed")
    ) {
      return "network_error";
    }

    return "unknown";
  }

  /**
   * Recover from syntax error
   */
  private async recoverFromSyntaxError(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    return {
      recovered: true,
      action: "regenerate",
      message: "Syntax error detected. Will regenerate code with syntax validation.",
      newContext: {
        ...context,
        // Flag to enable stricter validation
      },
    };
  }

  /**
   * Recover from timeout
   */
  private async recoverFromTimeout(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    const newTimeout = (context.timeout || 120000) * 2;

    return {
      recovered: true,
      action: "retry_with_longer_timeout",
      message: `Timeout occurred. Retrying with ${newTimeout / 1000}s timeout.`,
      newContext: {
        ...context,
        timeout: newTimeout,
      },
    };
  }

  /**
   * Recover from missing dependency
   */
  private async recoverFromDependencyError(
    error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    // Extract dependency name from error
    const depMatch = error.message.match(/cannot find module ['"]([^'"]+)['"]/i);
    const dependency = depMatch?.[1];

    if (dependency) {
      return {
        recovered: true,
        action: "install_dependency",
        message: `Installing missing dependency: ${dependency}`,
        newContext: context,
      };
    }

    return {
      recovered: false,
      action: "escalate",
      message: "Could not identify missing dependency from error message.",
    };
  }

  /**
   * Recover from test failure
   */
  private async recoverFromTestFailure(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    return {
      recovered: true,
      action: "analyze_and_fix",
      message: "Test failures detected. Will analyze root causes and generate fixes.",
      newContext: context,
    };
  }

  /**
   * Recover from LLM error
   */
  private async recoverFromLLMError(
    error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    const message = error.message.toLowerCase();

    // Rate limit error
    if (message.includes("rate limit")) {
      const waitTime = 60000; // 1 minute
      return {
        recovered: true,
        action: "wait_and_retry",
        message: `Rate limit hit. Waiting ${waitTime / 1000}s before retry.`,
        newContext: context,
      };
    }

    // Model overloaded
    if (message.includes("overloaded") || message.includes("capacity")) {
      return {
        recovered: true,
        action: "fallback_model",
        message: "Primary model overloaded. Falling back to alternate model.",
        newContext: {
          ...context,
          provider: this.getBackupProvider(context.provider),
        },
      };
    }

    // Invalid request
    if (message.includes("invalid") || message.includes("bad request")) {
      return {
        recovered: false,
        action: "escalate",
        message: "Invalid LLM request. Request parameters may need adjustment.",
      };
    }

    // Generic LLM error - retry
    return {
      recovered: true,
      action: "retry",
      message: "LLM error occurred. Retrying with same parameters.",
      newContext: context,
    };
  }

  /**
   * Recover from build error
   */
  private async recoverFromBuildError(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    return {
      recovered: true,
      action: "fix_build_errors",
      message: "Build errors detected. Will analyze and fix compilation issues.",
      newContext: context,
    };
  }

  /**
   * Recover from type error
   */
  private async recoverFromTypeError(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    return {
      recovered: true,
      action: "fix_type_errors",
      message: "Type errors detected. Will regenerate with correct types.",
      newContext: context,
    };
  }

  /**
   * Recover from network error
   */
  private async recoverFromNetworkError(
    _error: Error,
    context: ExecutionContext,
  ): Promise<RecoveryResult> {
    return {
      recovered: true,
      action: "retry_with_backoff",
      message: "Network error. Retrying with exponential backoff.",
      newContext: context,
    };
  }

  /**
   * Escalate to user
   */
  private async escalateToUser(error: Error, context: ExecutionContext): Promise<RecoveryResult> {
    return {
      recovered: false,
      action: "escalate",
      message: `Unrecoverable error in ${context.phase}: ${error.message}\n\nPlease review and provide guidance.`,
    };
  }

  /**
   * Get backup provider
   */
  private getBackupProvider(currentProvider?: string): string {
    const providers = ["anthropic", "openai", "google"];
    const current = currentProvider || "anthropic";
    const currentIndex = providers.indexOf(current);
    const nextIndex = (currentIndex + 1) % providers.length;
    const nextProvider = providers[nextIndex];
    return nextProvider || "anthropic";
  }

  /**
   * Reset retry count for a specific error type
   */
  resetRetries(classification: ErrorClassification, phase: string): void {
    const key = `${classification}-${phase}`;
    this.retryCount.delete(key);
  }

  /**
   * Reset all retry counts
   */
  resetAllRetries(): void {
    this.retryCount.clear();
  }
}

/**
 * Create a recovery system
 */
export function createRecoverySystem(): RecoverySystem {
  return new RecoverySystem();
}
