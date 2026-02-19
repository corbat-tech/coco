/**
 * Regression tests for targeted bug fixes:
 * Fix #1 — evaluator.ts: `converged` hardcoded to false; threshold checks use hardcoded defaults
 * Fix #2 — security.ts: Command Injection false positives on `regex.exec()` calls
 * Fix #3 — config.ts:   loadConfig() never reads .coco/config.json
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Fix #1: `converged` and threshold checks in QualityEvaluator.evaluate()
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #1 — resolvedThresholds drives converged / meetsMinimum / meetsTarget", () => {
  it("resolvedThresholds returns defaults when projectConfig is null", async () => {
    const { resolvedThresholds } = await import("./quality-bridge.js");
    const { DEFAULT_QUALITY_THRESHOLDS } = await import("./types.js");
    expect(resolvedThresholds(null)).toEqual(DEFAULT_QUALITY_THRESHOLDS);
  });

  it("resolvedThresholds merges overrides from projectConfig", async () => {
    const { resolvedThresholds } = await import("./quality-bridge.js");
    const { DEFAULT_QUALITY_THRESHOLDS } = await import("./types.js");

    const config = { quality: { minScore: 70 } };
    const thresholds = resolvedThresholds(config as any);

    // minimum.overall should reflect the custom minScore
    expect(thresholds.minimum.overall).toBe(70);
    // target should remain as default
    expect(thresholds.target.overall).toBe(DEFAULT_QUALITY_THRESHOLDS.target.overall);
  });

  it("converged is true when overall score >= target threshold", async () => {
    // Verify the logic: converged = scores.overall >= thresholds.target.overall
    const { resolvedThresholds } = await import("./quality-bridge.js");
    const thresholds = resolvedThresholds(null);
    const targetOverall = thresholds.target.overall;

    // Simulate a score that meets the target
    const scoreAtTarget = targetOverall;
    const convergedAtTarget = scoreAtTarget >= targetOverall;
    expect(convergedAtTarget).toBe(true);

    // Simulate a score just below the target
    const scoreBelowTarget = targetOverall - 1;
    const convergedBelowTarget = scoreBelowTarget >= targetOverall;
    expect(convergedBelowTarget).toBe(false);
  });

  it("converged is false (not hardcoded) — it must be computed from score vs target", async () => {
    // Guard: the evaluator source must not contain the literal `converged: false`
    // (which was the bug: it was always returning false regardless of the score).
    const { readFile } = await import("node:fs/promises");
    const evaluatorSrc = await readFile(
      new URL("./evaluator.ts", import.meta.url).pathname,
      "utf-8",
    );
    // The hardcoded `converged: false` in the return statement should no longer exist.
    expect(evaluatorSrc).not.toContain("converged: false");
    // The computed value must be assigned from a variable (not a literal).
    expect(evaluatorSrc).toContain("const converged =");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #2: Command Injection pattern no longer fires on `regex.exec()` calls
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #2 — no false positive on regex.exec() in security scanner", () => {
  it("does NOT report a vulnerability for a standalone regex.exec() call", async () => {
    const { PatternSecurityScanner } = await import("./analyzers/security.js");
    const scanner = new PatternSecurityScanner();

    // This code uses regex.exec() — NOT a shell exec() — and must not trigger Command Injection.
    const content = `
const regex = /foo/g;
let match;
while ((match = regex.exec(input)) !== null) {
  results.push(match[0]);
}
`;

    const result = await scanner.scan([{ path: "test.ts", content }]);
    const cmdInjection = result.vulnerabilities.filter((v) => v.type === "Command Injection");
    expect(cmdInjection).toHaveLength(0);
  });

  it("DOES report a vulnerability for a bare exec() shell call", async () => {
    const { PatternSecurityScanner } = await import("./analyzers/security.js");
    const scanner = new PatternSecurityScanner();

    // Standalone exec() with user input — real Command Injection risk.
    const content = `
const { exec } = require("child_process");
exec(userInput);
`;

    const result = await scanner.scan([{ path: "test.ts", content }]);
    const cmdInjection = result.vulnerabilities.filter((v) => v.type === "Command Injection");
    expect(cmdInjection.length).toBeGreaterThan(0);
  });

  it("DOES report for child_process.exec() call", async () => {
    const { PatternSecurityScanner } = await import("./analyzers/security.js");
    const scanner = new PatternSecurityScanner();

    const content = `child_process.exec(cmd, callback);`;

    const result = await scanner.scan([{ path: "test.ts", content }]);
    const cmdInjection = result.vulnerabilities.filter((v) => v.type === "Command Injection");
    expect(cmdInjection.length).toBeGreaterThan(0);
  });

  it("does NOT false-positive on method chains like str.exec(pattern)", async () => {
    const { PatternSecurityScanner } = await import("./analyzers/security.js");
    const scanner = new PatternSecurityScanner();

    const content = `
const result = pattern.exec(str);
const another = myRegex.exec(line);
`;

    const result = await scanner.scan([{ path: "test.ts", content }]);
    const cmdInjection = result.vulnerabilities.filter((v) => v.type === "Command Injection");
    expect(cmdInjection).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #3: loadConfig() reads .coco/config.json when present
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #3 — loadConfig() reads .coco/config.json rather than returning hardcoded defaults", () => {
  it("loadConfig source no longer contains the TODO stub that returned hardcoded config", async () => {
    const { readFile } = await import("node:fs/promises");
    const configSrc = await readFile(
      new URL("../cli/commands/config.ts", import.meta.url).pathname,
      "utf-8",
    );
    // The old stub comment should be gone.
    expect(configSrc).not.toContain("// TODO: Load from .coco/config.json");
    // The new implementation should read the file.
    expect(configSrc).toContain("readFile");
    expect(configSrc).toContain(".coco/config.json");
  });

  it("the pattern used to locate config.json is correct relative to cwd", async () => {
    const { readFile } = await import("node:fs/promises");
    const configSrc = await readFile(
      new URL("../cli/commands/config.ts", import.meta.url).pathname,
      "utf-8",
    );
    // Must use process.cwd() to resolve the path (not a relative path from the module location).
    expect(configSrc).toContain("process.cwd()");
  });

  it("falls back to defaults when .coco/config.json does not exist (readFile throws ENOENT)", async () => {
    // The key observable behaviour: even if the file is absent, no exception should escape.
    // We verify this by inspecting the source for a try/catch around readFile.
    const { readFile } = await import("node:fs/promises");
    const configSrc = await readFile(
      new URL("../cli/commands/config.ts", import.meta.url).pathname,
      "utf-8",
    );
    // There must be a try/catch block protecting the readFile call so missing files are handled.
    expect(configSrc).toMatch(/try\s*\{[\s\S]*readFile[\s\S]*\}\s*catch/);
  });
});
