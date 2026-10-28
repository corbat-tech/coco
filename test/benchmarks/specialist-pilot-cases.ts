import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationContext, SpecialistEvaluationCase } from "./specialist-evaluation.js";
import { hashSpecialistFixture } from "./specialist-evaluation.js";

const DEFAULT_ROOT = fileURLToPath(new URL("../fixtures/delegation/projects/", import.meta.url));
export interface PilotCaseMetadata {
  id: string;
  group: "local" | "ordered" | "independent";
  split: "development" | "reserved-after-implementation";
  snapshotId: string;
  fixtureSha256: string;
  acceptanceSha256: string;
  task: string;
  solutionFiles: string[];
}

/** The reserved split was created after core implementation; it is not a blind benchmark. */
export async function readPilotManifest(fixtureRoot = DEFAULT_ROOT): Promise<PilotCaseMetadata[]> {
  const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "manifest.json"), "utf8")) as {
    version: number;
    frozenAfterCoreImplementation: boolean;
    cases: PilotCaseMetadata[];
  };
  if (
    manifest.version !== 1 ||
    !manifest.frozenAfterCoreImplementation ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length !== 12
  )
    throw new Error("Pilot manifest must identify twelve post-implementation frozen coding cases.");
  if (new Set(manifest.cases.map((item) => item.id)).size !== 12)
    throw new Error("Pilot case IDs must be unique.");
  for (const item of manifest.cases) {
    if (
      !/^[a-z][a-z0-9-]+$/.test(item.id) ||
      !item.task ||
      !item.snapshotId ||
      !/^[a-f0-9]{64}$/.test(item.fixtureSha256) ||
      !/^[a-f0-9]{64}$/.test(item.acceptanceSha256)
    )
      throw new Error("Pilot manifest contains an invalid case identity or hash.");
  }
  return manifest.cases;
}

/** Return real coding fixtures for the generic harness; never copy grader or solution assets. */
export async function createPilotCases(
  fixtureRoot = DEFAULT_ROOT,
): Promise<SpecialistEvaluationCase[]> {
  return Promise.all(
    (await readPilotManifest(fixtureRoot)).map(async (item) => {
      const fixtureDirectory = path.join(fixtureRoot, item.id);
      if ((await hashSpecialistFixture(fixtureDirectory)) !== item.fixtureSha256)
        throw new Error(`Pilot source fixture '${item.id}' changed after freezing.`);
      return {
        id: item.id,
        snapshotId: item.snapshotId,
        fixtureDirectory,
        expectedFixtureSha256: item.fixtureSha256,
        acceptanceId: `${item.id}:${item.acceptanceSha256}`,
        task: item.task,
      };
    }),
  );
}

/**
 * Run the exact trusted external checker and the project's public regression test.
 * The submitted code executes in Node: this process boundary is not an OS sandbox.
 */
export async function checkPilotCase(
  context: EvaluationContext,
  fixtureRoot = DEFAULT_ROOT,
): Promise<Record<string, boolean>> {
  context.signal.throwIfAborted();
  const item = (await readPilotManifest(fixtureRoot)).find((entry) => entry.id === context.caseId);
  if (!item) throw new Error("Unknown pilot case; no model-selected grader path is accepted.");
  const script = path.join(fixtureRoot, "_acceptance", `${item.id}.test.mjs`);
  const actualHash = createHash("sha256")
    .update(await readFile(script))
    .digest("hex");
  if (actualHash !== item.acceptanceSha256)
    throw new Error("External pilot acceptance changed after freezing.");
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(10_000)]);
  const env: NodeJS.ProcessEnv = { PROJECT_UNDER_TEST: context.workspace, LANG: "C", TZ: "UTC" };
  if (process.platform === "win32" && process.env.SystemRoot)
    env.SystemRoot = process.env.SystemRoot;
  const observed = await new Promise<{ code: number | null; output: string; failed: boolean }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--test",
          "--experimental-test-isolation=none",
          "--test-reporter=tap",
          script,
          path.join(context.workspace, "public.test.mjs"),
        ],
        {
          cwd: context.workspace,
          env,
          signal,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      let failed = false;
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > 64_000) {
          failed = true;
          child.kill();
        }
      });
      // Drain errors without forwarding arbitrary submitted-code output into reports.
      child.stderr.on("data", () => {});
      child.on("error", () => {
        failed = true;
      });
      child.on("close", (code) => resolve({ code, output, failed }));
    },
  );
  const tests = Number(/^# tests (\d+)\s*$/m.exec(observed.output)?.[1] ?? 0);
  const passes = Number(/^# pass (\d+)\s*$/m.exec(observed.output)?.[1] ?? 0);
  return {
    processSucceeded: observed.code === 0 && !observed.failed && !signal.aborted,
    externalAndPublicTestsExecuted: tests >= 2,
    allObservedTestsPassed:
      tests >= 2 && passes === tests && /^# fail 0\s*$/m.test(observed.output),
  };
}
