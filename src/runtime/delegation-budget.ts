/** Shared admission accounting for worker requests. This is not an invoice or provider-side cap. */
export interface DelegationBudgetLimits {
  maxTurns: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A request reservation is made synchronously, before any provider await. */
export class DelegationBudget {
  private turns = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private reservedInput = 0;
  private reservedOutput = 0;
  private unknownRequests = 0;

  constructor(private readonly limits: DelegationBudgetLimits) {
    if (!Number.isSafeInteger(limits.maxTurns) || limits.maxTurns < 1)
      throw new RangeError("A positive shared maxTurns limit is required.");
    for (const value of Object.values(limits)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        throw new RangeError("Delegation limits must be positive safe integers.");
      }
    }
    this.limits = { ...limits };
  }

  /** Estimated input includes the composed prompt and offered tools, supplied by the executor. */
  reserve(input: { estimatedInputTokens: number; maxOutputTokens: number }): {
    settle: (usage?: WorkerUsage) => void;
  } {
    for (const value of [input.estimatedInputTokens, input.maxOutputTokens]) {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError("Invalid request reservation.");
    }
    if (this.turns >= this.limits.maxTurns)
      throw new Error("Shared delegation turn budget exhausted.");
    if (this.unknownRequests > 0)
      throw new Error("Worker usage is unknown; no further requests are admitted.");
    if (
      this.limits.maxInputTokens !== undefined &&
      this.inputTokens + this.reservedInput + input.estimatedInputTokens >
        this.limits.maxInputTokens
    ) {
      throw new Error("Shared delegation input token budget exhausted.");
    }
    if (
      this.limits.maxOutputTokens !== undefined &&
      this.outputTokens + this.reservedOutput + input.maxOutputTokens > this.limits.maxOutputTokens
    ) {
      throw new Error("Shared delegation output token budget exhausted.");
    }
    this.turns++;
    this.reservedInput += input.estimatedInputTokens;
    this.reservedOutput += input.maxOutputTokens;
    let settled = false;
    return {
      settle: (usage) => {
        if (settled) throw new Error("Request reservation already settled.");
        settled = true;
        this.reservedInput -= input.estimatedInputTokens;
        this.reservedOutput -= input.maxOutputTokens;
        if (
          !usage ||
          !Number.isFinite(usage.inputTokens) ||
          !Number.isFinite(usage.outputTokens) ||
          usage.inputTokens < 0 ||
          usage.outputTokens < 0
        ) {
          this.unknownRequests++;
          return;
        }
        this.inputTokens += usage.inputTokens;
        this.outputTokens += usage.outputTokens;
      },
    };
  }

  snapshot(): Readonly<
    WorkerUsage & { turns: number; activeRequests: boolean; unknownRequests: number }
  > {
    return {
      turns: this.turns,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      activeRequests: this.reservedInput > 0 || this.reservedOutput > 0,
      unknownRequests: this.unknownRequests,
    };
  }
}
