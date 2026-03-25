import { describe, it, expect } from "vitest";
import { computeTurnQualityMetrics, RepeatedOutputSuppressor } from "./turn-quality.js";

describe("computeTurnQualityMetrics", () => {
  it("returns high score for clean execution", () => {
    const metrics = computeTurnQualityMetrics({
      iterationsUsed: 1,
      maxIterations: 6,
      executedTools: [],
      hadError: false,
      repeatedOutputsSuppressed: 0,
    });

    expect(metrics.score).toBeGreaterThanOrEqual(90);
    expect(metrics.hadError).toBe(false);
  });

  it("penalizes errors and failed tools", () => {
    const metrics = computeTurnQualityMetrics({
      iterationsUsed: 6,
      maxIterations: 6,
      executedTools: [
        {
          id: "1",
          name: "read_file",
          input: {},
          result: { success: false, output: "", error: "boom" },
          duration: 1,
        },
      ],
      hadError: true,
      repeatedOutputsSuppressed: 0,
    });

    expect(metrics.score).toBeLessThan(70);
    expect(metrics.failedToolCalls).toBe(1);
  });
});

describe("RepeatedOutputSuppressor", () => {
  it("keeps first output and suppresses repeats", () => {
    const suppressor = new RepeatedOutputSuppressor();
    const first = suppressor.transform("read_file", "same output");
    const second = suppressor.transform("read_file", "same output");

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(second.content).toContain("Repeated tool output suppressed");
  });
});
