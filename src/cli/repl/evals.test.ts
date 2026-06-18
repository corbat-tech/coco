import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_FIXTURES, runDefaultEvals } from "./evals.js";

describe("eval fixtures", () => {
  it("defines default offline replay fixtures", () => {
    expect(DEFAULT_EVAL_FIXTURES.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_EVAL_FIXTURES.map((fixture) => fixture.id)).toContain("tool-read");
  });

  it("runs default evals successfully", async () => {
    const results = await runDefaultEvals();

    expect(results.every((result) => result.passed)).toBe(true);
  });
});
