import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashSpecialistFixture,
  runSpecialistEvaluation,
  type SpecialistEvaluationOptions,
} from "./specialist-evaluation.js";

const temporary: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<SpecialistEvaluationOptions> {
  const directory = await mkdtemp(path.join(tmpdir(), "coco-evaluation-"));
  temporary.push(directory);
  const source = path.join(directory, "fixture");
  await mkdir(source);
  await writeFile(path.join(source, "answer.txt"), "0");
  return {
    cases: [
      {
        id: "external-fixture",
        snapshotId: "fixture-v1",
        fixtureDirectory: source,
        expectedFixtureSha256: await hashSpecialistFixture(source),
        acceptanceId: "answer-equals-42-v1",
        task: "Write the requested answer",
      },
    ],
    repetitions: 1,
    maxRuns: 3,
    timeoutMs: 1000,
    outputDirectory: path.join(directory, "evidence"),
    identity: {
      commit: "fixture-commit",
      model: "scripted-test-provider",
      effort: "fixture",
      adapterVersion: "test-v1",
      toolPolicySha256: "policy-hash",
      promptSha256: "prompt-hash",
    },
    runCase: async ({ workspace }) => {
      await writeFile(path.join(workspace, "answer.txt"), "42");
      return { status: "completed", usage: { inputTokens: 10, outputTokens: 2 } };
    },
    check: async ({ workspace }) => ({
      actualAnswer: (await readFile(path.join(workspace, "answer.txt"), "utf8")) === "42",
    }),
  };
}

describe("reusable specialist evaluation harness", () => {
  it("retains host cancellation and starts no subsequent attempts", async () => {
    const options = await fixture();
    const controller = new AbortController();
    options.signal = controller.signal;
    const runCase = vi.fn(async () => {
      controller.abort(new Error("Host canceled evaluation"));
      return new Promise<never>(() => {});
    });
    options.runCase = runCase;
    const report = await runSpecialistEvaluation(options);
    expect(report.outcomes[0]?.status).toBe("cancelled");
    expect(report.notAttemptedRuns).toBe(2);
    expect(runCase).toHaveBeenCalledOnce();
  });

  it("uses identical frozen inputs in fresh workspaces and external file acceptance", async () => {
    const options = await fixture();
    const workspaces: string[] = [];
    options.runCase = async ({ workspace, configuration }) => {
      expect(await readFile(path.join(workspace, "answer.txt"), "utf8")).toBe("0");
      workspaces.push(workspace);
      if (configuration !== "manual") await writeFile(path.join(workspace, "answer.txt"), "42");
      return {
        status: "completed",
        trace: ["Agent declared a perfect score; this is not acceptance."],
      };
    };
    const report = await runSpecialistEvaluation(options);
    expect(report.outcomes.map((run) => run.status)).toEqual(["accepted", "rejected", "accepted"]);
    expect(report.outcomes.every((run) => run.usage === null)).toBe(true);
    expect(new Set(workspaces).size).toBe(3);
    expect(
      await readFile(path.join(options.cases[0]!.fixtureDirectory, "answer.txt"), "utf8"),
    ).toBe("0");
    const manifest = JSON.parse(
      await readFile(path.join(options.outputDirectory, "manifest.json"), "utf8"),
    );
    const { manifestSha256, ...body } = manifest;
    expect(manifestSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(body.cases[0].fixtureSha256).toBe(options.cases[0]!.expectedFixtureSha256);
    expect(body.environment.node).toBe(process.version);
  });

  it("rotates configuration order while preserving every paired case and repetition", async () => {
    const options = await fixture();
    options.cases = [options.cases[0]!, { ...options.cases[0]!, id: "second-fixture" }];
    options.repetitions = 2;
    options.maxRuns = 12;
    const report = await runSpecialistEvaluation(options);
    expect(report.attemptedRuns).toBe(12);
    expect(report.notAttemptedRuns).toBe(0);
    expect(report.outcomes.slice(0, 6).map((run) => run.configuration)).toEqual([
      "direct",
      "manual",
      "auto",
      "manual",
      "auto",
      "direct",
    ]);
    for (const item of options.cases)
      for (const mode of ["direct", "manual", "auto"])
        expect(
          report.outcomes.filter((run) => run.caseId === item.id && run.configuration === mode),
        ).toHaveLength(2);
  });

  it("retains failed attempts and unknown usage, redacting trace and error secrets", async () => {
    const options = await fixture();
    const apiKey = `sk-${"a".repeat(30)}`;
    options.sensitiveValues = ['private-password-with-quotes"'];
    options.runCase = async ({ configuration, workspace }) => {
      if (configuration === "direct") throw new Error(`Provider failed: ${apiKey}`);
      await writeFile(path.join(workspace, "answer.txt"), "42");
      return {
        status: configuration === "manual" ? "failed" : "completed",
        error: configuration === "manual" ? "Worker failed despite partial effects" : undefined,
        usage: { inputTokens: 4, outputTokens: 1 },
        trace: [`token ${apiKey}`, 'private-password-with-quotes"'],
      };
    };
    const report = await runSpecialistEvaluation(options);
    expect(report.outcomes.map((run) => run.status)).toEqual(["failed", "failed", "accepted"]);
    expect(report.outcomes[0]?.usage).toBeNull();
    expect(report.outcomes[1]?.checks.actualAnswer).toBe(true);
    const traces = await readFile(path.join(options.outputDirectory, "traces.jsonl"), "utf8");
    expect(traces).not.toContain(apiKey);
    expect(traces).not.toContain("private-password");
    expect(JSON.stringify(report)).not.toContain(apiKey);
    expect(
      traces
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toHaveLength(6);
  });

  it("rejects changed fixtures and an incomplete approved paired budget before dispatch", async () => {
    const options = await fixture();
    const runCase = vi.fn(options.runCase);
    options.runCase = runCase;
    await expect(runSpecialistEvaluation({ ...options, maxRuns: 2 })).rejects.toThrow(
      "paired campaign",
    );
    await writeFile(path.join(options.cases[0]!.fixtureDirectory, "answer.txt"), "changed");
    await expect(runSpecialistEvaluation(options)).rejects.toThrow("Fixture hash changed");
    expect(runCase).not.toHaveBeenCalled();
  });

  it("aborts a stuck adapter at the deadline, retains its workspace and starts no later runs", async () => {
    const options = await fixture();
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const runCase = vi.fn(async ({ signal }) => {
      observedSignal = signal;
      started();
      return new Promise<never>(() => {}); // Intentionally non-cooperative adapter.
    });
    options.runCase = runCase;
    options.timeoutMs = 10;
    const pending = runSpecialistEvaluation(options);
    await ready;
    await vi.advanceTimersByTimeAsync(11);
    const report = await pending;
    expect(observedSignal?.aborted).toBe(true);
    expect(report.outcomes[0]?.status).toBe("timeout");
    expect(report.attemptedRuns).toBe(1);
    expect(report.notAttemptedRuns).toBe(2);
    expect(report.outcomes[0]?.usage).toBeNull();
    expect(await readFile(path.join(report.outcomes[0]!.workspace, "answer.txt"), "utf8")).toBe(
      "0",
    );
    expect(runCase).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects symlink fixtures and invalid external checker output", async () => {
    const options = await fixture();
    await symlink("answer.txt", path.join(options.cases[0]!.fixtureDirectory, "link.txt"));
    await expect(hashSpecialistFixture(options.cases[0]!.fixtureDirectory)).rejects.toThrow(
      "symlinks",
    );
    await rm(path.join(options.cases[0]!.fixtureDirectory, "link.txt"));
    options.check = async () => ({});
    const report = await runSpecialistEvaluation(options);
    expect(
      report.outcomes.every(
        (run) => run.status === "failed" && run.error?.includes("nonempty boolean"),
      ),
    ).toBe(true);
  });
});
