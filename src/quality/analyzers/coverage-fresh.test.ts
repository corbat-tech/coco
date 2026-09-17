import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoverageAnalyzer } from "./coverage.js";
import { runQualityCommand } from "../command.js";
vi.mock("../command.js", () => ({ runQualityCommand: vi.fn() }));
const metric = { total: 10, covered: 10, skipped: 0, pct: 100 };
const report = JSON.stringify({
  total: { lines: metric, branches: metric, functions: metric, statements: metric },
});

describe("fresh coverage evidence", () => {
  let cwd: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    cwd = await mkdtemp(join(tmpdir(), "coco-fresh-fixture-"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "*" } }),
    );
    await mkdir(join(cwd, "coverage"));
    await writeFile(join(cwd, "coverage", "coverage-summary.json"), report);
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  it("rejects a stale perfect report when this invocation creates no report", async () => {
    vi.mocked(runQualityCommand).mockResolvedValue({ exitCode: 0, stdout: "passed", stderr: "" });
    await expect(new CoverageAnalyzer(cwd).analyzeFresh()).rejects.toThrow(
      "Coverage analysis failed",
    );
    expect(vi.mocked(runQualityCommand).mock.calls[0]?.[1]).toContain("--no-install");
  });
  it("uses and removes the report uniquely produced by the current invocation", async () => {
    let directory = "";
    vi.mocked(runQualityCommand).mockImplementation(async (_command, args) => {
      directory = args
        .find((arg) => arg.startsWith("--coverage.reportsDirectory="))!
        .split("=")
        .slice(1)
        .join("=");
      await writeFile(join(directory, "coverage-summary.json"), report);
      return { exitCode: 0, stdout: "passed", stderr: "" };
    });
    expect((await new CoverageAnalyzer(cwd).analyzeFresh()).lines.percentage).toBe(100);
    expect(directory).not.toBe(join(cwd, "coverage"));
    await expect(access(directory)).rejects.toThrow();
  });
});
