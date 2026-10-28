import { describe, expect, it } from "vitest";
import { DelegationBudget } from "./delegation-budget.js";

describe("shared worker budget", () => {
  it("reserves atomically before concurrent requests and counts turns across workers", () => {
    const budget = new DelegationBudget({ maxTurns: 2, maxInputTokens: 20, maxOutputTokens: 10 });
    const a = budget.reserve({ estimatedInputTokens: 10, maxOutputTokens: 8 });
    expect(() => budget.reserve({ estimatedInputTokens: 10, maxOutputTokens: 8 })).toThrow(
      "output token",
    );
    a.settle({ inputTokens: 10, outputTokens: 2 });
    const b = budget.reserve({ estimatedInputTokens: 10, maxOutputTokens: 8 });
    b.settle({ inputTokens: 10, outputTokens: 3 });
    expect(() => budget.reserve({ estimatedInputTokens: 0, maxOutputTokens: 0 })).toThrow("turn");
    expect(budget.snapshot()).toMatchObject({
      turns: 2,
      inputTokens: 20,
      outputTokens: 5,
      activeRequests: false,
    });
  });
  it("does not treat missing usage as free consumption", () => {
    const budget = new DelegationBudget({ maxTurns: 10 });
    budget.reserve({ estimatedInputTokens: 1, maxOutputTokens: 1 }).settle();
    expect(budget.snapshot().unknownRequests).toBe(1);
    expect(() => budget.reserve({ estimatedInputTokens: 0, maxOutputTokens: 0 })).toThrow(
      "unknown",
    );
  });
  it("accounts actual input overruns and rejects subsequent reservations", () => {
    const budget = new DelegationBudget({ maxTurns: 10, maxInputTokens: 2 });
    budget
      .reserve({ estimatedInputTokens: 1, maxOutputTokens: 1 })
      .settle({ inputTokens: 3, outputTokens: 1 });
    expect(() => budget.reserve({ estimatedInputTokens: 0, maxOutputTokens: 0 })).toThrow(
      "input token",
    );
  });
  it("validates limits and reservations and rejects double settlement", () => {
    expect(() => new DelegationBudget({ maxTurns: 0 })).toThrow(RangeError);
    expect(() => new DelegationBudget({} as never)).toThrow(RangeError);
    const budget = new DelegationBudget({ maxTurns: 1 });
    expect(() => budget.reserve({} as never)).toThrow(RangeError);
    expect(() => budget.reserve({ estimatedInputTokens: -1, maxOutputTokens: 0 })).toThrow(
      RangeError,
    );
    const a = budget.reserve({ estimatedInputTokens: 1, maxOutputTokens: 1 });
    a.settle({ inputTokens: 0, outputTokens: 0 });
    expect(() => a.settle()).toThrow("already settled");
  });
});
