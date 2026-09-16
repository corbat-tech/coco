import { stripVTControlCharacters } from "node:util";
import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatQualityResult,
  getQualityLoopSystemPrompt,
  isQualityLoop,
  parseQualityLoopReport,
  setQualityLoop,
} from "./quality-loop.js";
import { qualityCommand } from "./commands/quality.js";
import type { ReplSession } from "./types.js";

const perfectReport = `QUALITY_LOOP_REPORT
score_history: [100, 100]
tests_passed: 42
tests_total: 42
coverage: 100
security: 100
iterations: 2
converged: true`;

describe("quality self-reports are never presented as verified acceptance", () => {
  let previousLevel: typeof chalk.level;
  let previousEnabled: boolean;

  beforeEach(() => {
    previousLevel = chalk.level;
    previousEnabled = isQualityLoop();
    chalk.level = 1;
  });

  afterEach(() => {
    chalk.level = previousLevel;
    setQualityLoop(previousEnabled);
    vi.restoreAllMocks();
  });

  it("parses a perfect model-authored report but labels every metric as unverified/reported", () => {
    const parsed = parseQualityLoopReport(perfectReport);
    expect(parsed).toMatchObject({ converged: true, finalScore: 100, securityScore: 100 });
    const rendered = formatQualityResult(parsed!);
    const plain = stripVTControlCharacters(rendered);
    expect(plain).toContain("Quality self-report (unverified)");
    expect(plain).toMatch(/reported tests:\s*42\/42/i);
    expect(plain).toMatch(/reported coverage:\s*100%/i);
    expect(plain).toMatch(/reported security:\s*100/i);
    expect(rendered).not.toContain(String.fromCharCode(27) + "[32m");
    expect(rendered).not.toContain(String.fromCharCode(27) + "[92m");
  });

  it("does not infer exhaustion of the iteration budget from converged=false", () => {
    const parsed = parseQualityLoopReport(
      perfectReport
        .replace("converged: true", "converged: false")
        .replace("iterations: 2", "iterations: 1"),
    );
    const plain = stripVTControlCharacters(formatQualityResult(parsed!));
    expect(plain).toContain("Quality self-report (unverified)");
    expect(plain).not.toMatch(/max(?:imum)? iterations|iteration limit|budget exhausted/i);
    expect(plain).toMatch(/iterations:\s*1/i);
  });

  it("keeps unknown security unknown rather than manufacturing a perfect security result", () => {
    const parsed = parseQualityLoopReport(
      perfectReport.replace("security: 100", "security: unknown"),
    );
    expect(parsed?.securityScore).toBeUndefined();
    const plain = stripVTControlCharacters(formatQualityResult(parsed!));
    expect(plain).toContain("Quality self-report (unverified)");
    expect(plain).not.toMatch(/security:\s*100/i);
  });

  it("labels a score-only report unverified even when no supporting metrics were supplied", () => {
    const parsed = parseQualityLoopReport(
      "QUALITY_LOOP_REPORT\nscore_history: [100]\nconverged: true",
    );
    expect(parsed).not.toBeNull();
    const plain = stripVTControlCharacters(formatQualityResult(parsed!));
    expect(plain).toContain("Quality self-report (unverified)");
    expect(plain).not.toMatch(/tests:\s*\d|coverage:\s*\d|security:\s*\d/i);
  });

  it("retains the report protocol while requiring observed tool evidence or unknown metrics", () => {
    const prompt = getQualityLoopSystemPrompt();
    expect(prompt).toContain("QUALITY_LOOP_REPORT");
    expect(prompt).toContain("score_history:");
    expect(prompt).toMatch(/security:\s*unknown/i);
    expect(prompt).not.toMatch(/security:\s*100/);
    expect(prompt).toMatch(/observed|verified tool|tool (?:output|results)/i);
    expect(prompt).toMatch(/subjective|self.assess|self.report/i);
  });

  it("quality status/help does not promise guaranteed convergence", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    setQualityLoop(true);
    // The status branch is read-only: no preference persistence is invoked.
    await qualityCommand.execute(["status"], {} as ReplSession);
    const plain = stripVTControlCharacters(
      [qualityCommand.description, ...output.mock.calls.flat()].join("\n"),
    );
    expect(plain).not.toMatch(/iterate until (?:quality )?converge|iterate until quality\s*[≥>=]/i);
    expect(plain).toMatch(/unverified|self.report|not guaranteed/i);
  });
});
