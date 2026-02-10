/**
 * Cost Estimator
 *
 * Estimates cost before expensive operations
 */

/**
 * Token cost per 1M tokens (input/output)
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4": { input: 0.8, output: 4 },

  // OpenAI
  "gpt-4": { input: 30, output: 60 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },

  // Google
  "gemini-pro": { input: 0.5, output: 1.5 },
  "gemini-flash": { input: 0.075, output: 0.3 },

  // Moonshot
  "moonshot-v1": { input: 1, output: 1 },
};

/**
 * Estimate tokens for text
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

/**
 * Get cost for model
 */
function getModelCost(model: string): { input: number; output: number } {
  // Try exact match
  if (MODEL_COSTS[model]) {
    return MODEL_COSTS[model];
  }

  // Try partial match (sort by key length descending for longest match first)
  const sortedEntries = Object.entries(MODEL_COSTS).sort(([a], [b]) => b.length - a.length);
  for (const [key, cost] of sortedEntries) {
    if (model.includes(key)) {
      return cost;
    }
  }

  // Default to mid-tier
  return { input: 3, output: 15 };
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  minCost: number;
  maxCost: number;
  expectedCost: number;
  warning: boolean;
}

/**
 * Estimate cost for a prompt
 */
export function estimateCost(
  prompt: string,
  model: string,
  options: {
    cocoMode?: boolean;
    iterations?: number;
  } = {},
): CostEstimate {
  const inputTokens = estimateTokens(prompt);

  // Estimate output tokens (heuristic: 1-3x input for code generation)
  const outputTokensMin = inputTokens;
  const outputTokensMax = inputTokens * 3;
  const outputTokensExpected = inputTokens * 2;

  // Apply COCO multiplier if in COCO mode
  const iterations = options.cocoMode ? options.iterations || 3 : 1;

  const costs = getModelCost(model);

  const minCost =
    ((inputTokens * costs.input + outputTokensMin * costs.output) / 1_000_000) * iterations;
  const maxCost =
    ((inputTokens * costs.input + outputTokensMax * costs.output) / 1_000_000) * iterations;
  const expectedCost =
    ((inputTokens * costs.input + outputTokensExpected * costs.output) / 1_000_000) * iterations;

  return {
    estimatedInputTokens: inputTokens * iterations,
    estimatedOutputTokens: outputTokensExpected * iterations,
    minCost,
    maxCost,
    expectedCost,
    warning: expectedCost > 0.5, // Warn if > $0.50
  };
}

/**
 * Format cost estimate for display
 */
export function formatCostEstimate(estimate: CostEstimate): string {
  const lines: string[] = [];

  lines.push(`Estimated cost: $${estimate.expectedCost.toFixed(3)}`);
  lines.push(`  Range: $${estimate.minCost.toFixed(3)} - $${estimate.maxCost.toFixed(3)}`);
  lines.push(
    `  Tokens: ~${estimate.estimatedInputTokens} in + ~${estimate.estimatedOutputTokens} out`,
  );

  if (estimate.warning) {
    lines.push(`  ⚠️  This operation may be expensive (>$0.50)`);
  }

  return lines.join("\n");
}

/**
 * Budget tracker
 */
export class BudgetTracker {
  private budget: number = 0;
  private spent: number = 0;

  setBudget(amount: number): void {
    this.budget = amount;
  }

  addSpent(amount: number): void {
    this.spent += amount;
  }

  getRemaining(): number {
    return this.budget - this.spent;
  }

  getPercentage(): number {
    if (this.budget === 0) return 0;
    return (this.spent / this.budget) * 100;
  }

  shouldWarn(): boolean {
    return this.getPercentage() >= 80;
  }

  shouldPause(): boolean {
    return this.getPercentage() >= 95;
  }

  format(): string {
    const lines: string[] = [];
    lines.push(`Budget: $${this.budget.toFixed(2)}`);
    lines.push(`Spent: $${this.spent.toFixed(2)} (${this.getPercentage().toFixed(1)}%)`);
    lines.push(`Remaining: $${this.getRemaining().toFixed(2)}`);

    if (this.shouldPause()) {
      lines.push(`🛑 Budget exceeded! Pausing operations.`);
    } else if (this.shouldWarn()) {
      lines.push(`⚠️  Warning: ${this.getPercentage().toFixed(0)}% of budget used`);
    }

    return lines.join("\n");
  }
}
