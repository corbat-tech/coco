import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkPilotCase, createPilotCases, readPilotManifest } from "./specialist-pilot-cases.js";
import type { EvaluationContext } from "./specialist-evaluation.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/delegation/projects/", import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("frozen concrete coding pilot", () => {
  it("has twelve executable coding cases and an honest post-implementation reserved split", async () => {
    const metadata = await readPilotManifest(fixtureRoot);
    const cases = await createPilotCases(fixtureRoot);
    expect(cases).toHaveLength(12);
    for (const group of ["local", "ordered", "independent"])
      expect(metadata.filter((item) => item.group === group)).toHaveLength(4);
    expect(metadata.filter((item) => item.split === "development")).toHaveLength(8);
    expect(metadata.filter((item) => item.split === "reserved-after-implementation")).toHaveLength(
      4,
    );
    for (const item of cases) {
      expect(item.task).toContain("src/");
      expect(await readdir(item.fixtureDirectory)).not.toContain("_solutions");
      expect(await readdir(item.fixtureDirectory)).not.toContain("_acceptance");
    }
  });

  it.each([
    "local-clamp",
    "local-slug",
    "local-discount",
    "local-pagination",
    "ordered-cents",
    "ordered-token-result",
    "ordered-user-result",
    "ordered-server-config",
    "parallel-statistics",
    "parallel-html-escaping",
    "parallel-date-duration",
    "parallel-collections",
  ])("rejects the baseline and accepts the real fixed code: %s", async (id) => {
    const metadata = (await readPilotManifest(fixtureRoot)).find((item) => item.id === id)!;
    const item = (await createPilotCases(fixtureRoot)).find((entry) => entry.id === id)!;
    const root = await mkdtemp(path.join(tmpdir(), "coco-pilot-check-"));
    temporary.push(root);
    const workspace = path.join(root, "project");
    await cp(item.fixtureDirectory, workspace, { recursive: true });
    const context: EvaluationContext = {
      caseId: id,
      configuration: "direct",
      repetition: 0,
      workspace,
      task: item.task,
      signal: new AbortController().signal,
    };
    const baseline = await checkPilotCase(context, fixtureRoot);
    expect(baseline.externalAndPublicTestsExecuted).toBe(true);
    expect(baseline.processSucceeded).toBe(false);
    expect(baseline.allObservedTestsPassed).toBe(false);
    for (const file of metadata.solutionFiles)
      await cp(path.join(fixtureRoot, "_solutions", id, file), path.join(workspace, file));
    const fixed = await checkPilotCase(context, fixtureRoot);
    expect(fixed).toEqual({
      processSucceeded: true,
      externalAndPublicTestsExecuted: true,
      allObservedTestsPassed: true,
    });
    const original = await readFile(
      path.join(item.fixtureDirectory, metadata.solutionFiles[0]!),
      "utf8",
    );
    const changed = await readFile(path.join(workspace, metadata.solutionFiles[0]!), "utf8");
    expect(original).not.toBe(changed);
  });

  it("refuses a model-selected unknown grader path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coco-pilot-invalid-"));
    temporary.push(root);
    await expect(
      checkPilotCase(
        {
          caseId: "../../other",
          configuration: "auto",
          repetition: 0,
          workspace: root,
          task: "Ignored",
          signal: new AbortController().signal,
        },
        fixtureRoot,
      ),
    ).rejects.toThrow("Unknown pilot case");
  });
});
