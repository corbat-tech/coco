/**
 * Context window manager for automatic token tracking
 * Monitors token usage and triggers compaction when threshold is exceeded
 */

/**
 * Configuration for the context manager
 */
export interface ContextManagerConfig {
  /** Maximum tokens available (from provider.getContextWindow()) */
  maxTokens: number;
  /** Threshold percentage (0-1) at which to trigger compaction (default 0.8 = 80%) */
  compactionThreshold: number;
  /** Tokens reserved for response generation (default 4096) */
  reservedTokens: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONTEXT_CONFIG: ContextManagerConfig = {
  maxTokens: 200000,
  compactionThreshold: 0.8,
  reservedTokens: 4096,
};

/**
 * Context usage statistics
 */
export interface ContextUsageStats {
  /** Tokens currently used */
  used: number;
  /** Tokens available for use (excluding reserved) */
  available: number;
  /** Total capacity */
  total: number;
  /** Usage percentage (0-100) */
  percentage: number;
  /** Whether compaction is recommended */
  shouldCompact: boolean;
}

/**
 * Manages context window usage and determines when compaction is needed
 */
export class ContextManager {
  private usedTokens: number = 0;
  private config: ContextManagerConfig;

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
    };
  }

  /**
   * Add tokens to the usage counter
   */
  addTokens(count: number): void {
    if (count < 0) {
      throw new Error("Token count cannot be negative");
    }
    this.usedTokens += count;
  }

  /**
   * Remove tokens from the usage counter
   */
  removeTokens(count: number): void {
    if (count < 0) {
      throw new Error("Token count cannot be negative");
    }
    this.usedTokens = Math.max(0, this.usedTokens - count);
  }

  /**
   * Set the used token count directly
   */
  setUsedTokens(count: number): void {
    if (count < 0) {
      throw new Error("Token count cannot be negative");
    }
    this.usedTokens = count;
  }

  /**
   * Get the number of tokens currently used
   */
  getUsedTokens(): number {
    return this.usedTokens;
  }

  /**
   * Get the number of tokens available (excluding reserved)
   */
  getAvailableTokens(): number {
    const effectiveMax = this.config.maxTokens - this.config.reservedTokens;
    return Math.max(0, effectiveMax - this.usedTokens);
  }

  /**
   * Get usage percentage (0-100)
   */
  getUsagePercent(): number {
    const effectiveMax = this.config.maxTokens - this.config.reservedTokens;
    if (effectiveMax <= 0) return 100;
    return Math.min(100, (this.usedTokens / effectiveMax) * 100);
  }

  /**
   * Check if compaction should be triggered
   */
  shouldCompact(): boolean {
    const usageRatio = this.usedTokens / (this.config.maxTokens - this.config.reservedTokens);
    return usageRatio >= this.config.compactionThreshold;
  }

  /**
   * Get full usage statistics
   */
  getUsageStats(): ContextUsageStats {
    const effectiveMax = this.config.maxTokens - this.config.reservedTokens;
    return {
      used: this.usedTokens,
      available: this.getAvailableTokens(),
      total: effectiveMax,
      percentage: this.getUsagePercent(),
      shouldCompact: this.shouldCompact(),
    };
  }

  /**
   * Reset the token counter
   */
  reset(): void {
    this.usedTokens = 0;
  }

  /**
   * Update configuration (e.g., when switching providers/models)
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextManagerConfig {
    return { ...this.config };
  }

  /**
   * Format usage for display
   */
  formatUsage(): string {
    const stats = this.getUsageStats();
    const usedK = (stats.used / 1000).toFixed(1);
    const totalK = (stats.total / 1000).toFixed(1);
    return `${usedK}k/${totalK}k tokens (${stats.percentage.toFixed(0)}%)`;
  }
}

/**
 * Create a context manager with provider-aware defaults
 */
export function createContextManager(
  maxTokens: number,
  config?: Partial<Omit<ContextManagerConfig, "maxTokens">>
): ContextManager {
  return new ContextManager({
    maxTokens,
    ...config,
  });
}
