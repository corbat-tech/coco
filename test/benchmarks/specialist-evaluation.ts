import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../../src/runtime/guardrails.js";

export type EvaluationConfiguration = "direct" | "manual" | "auto";
export interface SpecialistEvaluationCase {
  id: string;
  snapshotId: string;
  fixtureDirectory: string;
  expectedFixtureSha256: string;
  /** Version or hash of the independently maintained acceptance implementation. */
  acceptanceId: string;
  task: string;
}
export interface EvaluationContext {
  readonly caseId: string;
  readonly configuration: EvaluationConfiguration;
  readonly repetition: number;
  readonly workspace: string;
  readonly task: string;
  readonly signal: AbortSignal;
}
export interface EvaluationAdapterResult {
  status: "completed" | "failed";
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Sanitized observable events only; never chain of thought or credentials. */
  trace?: string[];
}
export interface SpecialistEvaluationOptions {
  cases: readonly SpecialistEvaluationCase[];
  configurations?: readonly EvaluationConfiguration[];
  repetitions: number;
  maxRuns: number;
  timeoutMs: number;
  /** Must not already exist. Retains manifest, JSONL outcomes and isolated workspaces. */
  outputDirectory: string;
  identity: {
    commit: string;
    model: string;
    effort: string;
    adapterVersion: string;
    toolPolicySha256: string;
    promptSha256: string;
  };
  runCase(context: EvaluationContext): Promise<EvaluationAdapterResult>;
  /** Independently inspects actual workspace behavior; never an agent self-score. */
  check(context: EvaluationContext): Promise<Record<string, boolean>>;
  signal?: AbortSignal;
  sensitiveValues?: readonly string[];
}
export interface EvaluationOutcome {
  runId: string;
  caseId: string;
  configuration: EvaluationConfiguration;
  repetition: number;
  workspace: string;
  status: "accepted" | "rejected" | "failed" | "timeout" | "cancelled";
  checks: Record<string, boolean>;
  durationMs: number;
  usage: EvaluationAdapterResult["usage"] | null;
  error?: string;
}

interface FrozenFile {
  name: string;
  bytes: Buffer;
  mode: number;
}
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const validId = (value: string): boolean => /^[a-z0-9_-]{1,160}$/i.test(value);

async function freezeFixture(directory: string): Promise<{ files: FrozenFile[]; sha256: string }> {
  const files: FrozenFile[] = [];
  let bytes = 0;
  const visit = async (relative = ""): Promise<void> => {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const file = path.join(relative, name);
      const stat = await lstat(path.join(directory, file));
      if (stat.isSymbolicLink()) throw new Error("Evaluation fixtures cannot contain symlinks.");
      if (stat.isDirectory()) await visit(file);
      else if (stat.isFile()) {
        const content = await readFile(path.join(directory, file));
        bytes += content.length;
        if (files.length >= 4096 || bytes > 32 * 1024 * 1024)
          throw new Error(
            "Evaluation fixture exceeds 4096 files or 32 MiB; freeze a smaller fixture.",
          );
        files.push({
          name: file.replaceAll(path.sep, "/"),
          bytes: content,
          mode: stat.mode & 0o777,
        });
      } else
        throw new Error("Only regular files and directories are allowed in evaluation fixtures.");
    }
  };
  await visit();
  if (!files.length) throw new Error("Evaluation fixtures require at least one file.");
  return {
    files,
    sha256: sha(JSON.stringify(files.map((file) => [file.name, sha(file.bytes), file.mode]))),
  };
}

/** Freeze this hash into the corpus before tuning prompts or evaluating reserved cases. */
export async function hashSpecialistFixture(directory: string): Promise<string> {
  return (await freezeFixture(directory)).sha256;
}

/**
 * Provider-neutral campaign runner. It never creates a provider or starts paid requests itself.
 * A deadline aborts the adapter, records the attempt and stops the campaign. The adapter must
 * terminate its own subprocesses; retained workspaces are never deleted behind a late effect.
 */
export async function runSpecialistEvaluation(options: SpecialistEvaluationOptions) {
  for (const value of [options.repetitions, options.maxRuns, options.timeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError("Evaluation limits must be positive safe integers.");
  }
  if (options.timeoutMs > 2_147_483_647) throw new RangeError("Evaluation timeout is too large.");
  const configurations = [...(options.configurations ?? ["direct", "manual", "auto"])];
  if (
    !configurations.length ||
    configurations.some((mode) => !["direct", "manual", "auto"].includes(mode)) ||
    new Set(configurations).size !== configurations.length
  )
    throw new Error("Evaluation configurations must be distinct direct/manual/auto values.");
  if (
    !options.cases.length ||
    new Set(options.cases.map((item) => item.id)).size !== options.cases.length
  )
    throw new Error("Evaluation cases require distinct nonempty IDs.");
  const scheduledRuns = options.cases.length * configurations.length * options.repetitions;
  if (!Number.isSafeInteger(scheduledRuns) || scheduledRuns > options.maxRuns)
    throw new Error("The complete paired campaign exceeds the approved run budget.");
  const identityFields = [
    "commit",
    "model",
    "effort",
    "adapterVersion",
    "toolPolicySha256",
    "promptSha256",
  ] as const;
  if (
    identityFields.some(
      (key) => typeof options.identity[key] !== "string" || !options.identity[key].trim(),
    )
  )
    throw new Error("Evaluation identity fields are required.");
  options.signal?.throwIfAborted();
  const cases = await Promise.all(
    options.cases.map(async (item) => {
      if (!validId(item.id) || !item.snapshotId || !item.acceptanceId || !item.task.trim())
        throw new Error("A case requires a safe ID, snapshot, acceptance version and task.");
      const fixture = await freezeFixture(item.fixtureDirectory);
      if (fixture.sha256 !== item.expectedFixtureSha256)
        throw new Error(`Fixture hash changed for '${item.id}'.`);
      return { ...item, fixture };
    }),
  );
  const sanitize = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item !== "string") return item;
      let text = item;
      for (const secret of options.sensitiveValues ?? [])
        if (secret) text = text.split(secret).join("[REDACTED]");
      return redactSecrets(text).content;
    });
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const workspaces = path.join(options.outputDirectory, "workspaces");
  await mkdir(workspaces, { mode: 0o700 });
  const environment = { node: process.version, platform: process.platform, arch: process.arch };
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    identity: { ...options.identity },
    environment,
    environmentSha256: sha(JSON.stringify(environment)),
    configurations,
    repetitions: options.repetitions,
    maxRuns: options.maxRuns,
    timeoutMs: options.timeoutMs,
    scheduledRuns,
    cases: cases.map(({ fixture, id, snapshotId, acceptanceId, task }) => ({
      id,
      snapshotId,
      acceptanceId,
      taskSha256: sha(task),
      fixtureSha256: fixture.sha256,
    })),
  };
  const manifestSha256 = sha(sanitize(manifest));
  await writeFile(
    path.join(options.outputDirectory, "manifest.json"),
    sanitize({ ...manifest, manifestSha256 }),
    { mode: 0o600 },
  );
  const outcomes: EvaluationOutcome[] = [];
  const log = (value: unknown) =>
    appendFile(path.join(options.outputDirectory, "traces.jsonl"), `${sanitize(value)}\n`, {
      mode: 0o600,
    });
  let stoppedReason: string | undefined;
  campaign: for (let repetition = 0; repetition < options.repetitions; repetition++) {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
      const item = cases[caseIndex]!;
      // Rotate and reverse across paired cases/repetitions to reduce order effects.
      const offset = (caseIndex + repetition) % configurations.length;
      const order = [...configurations.slice(offset), ...configurations.slice(0, offset)];
      if (repetition % 2) order.reverse();
      for (const configuration of order) {
        if (options.signal?.aborted) {
          stoppedReason = "Host cancelled before the next attempt.";
          break campaign;
        }
        const workspace = await mkdtemp(path.join(workspaces, `${item.id}-${configuration}-`));
        for (const file of item.fixture.files) {
          const destination = path.join(workspace, file.name);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, file.bytes, { mode: file.mode });
        }
        const runId = randomUUID();
        const started = performance.now();
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        const context: EvaluationContext = Object.freeze({
          caseId: item.id,
          configuration,
          repetition,
          workspace,
          task: item.task,
          signal: controller.signal,
        });
        let adapter: EvaluationAdapterResult | undefined;
        let checks: Record<string, boolean> = {};
        let status: EvaluationOutcome["status"] = "failed";
        let error: string | undefined;
        await log({
          type: "attempt.started",
          runId,
          caseId: item.id,
          configuration,
          repetition,
          manifestSha256,
        });
        const timer = setTimeout(
          () => controller.abort(new DOMException("Evaluation deadline exceeded", "TimeoutError")),
          options.timeoutMs,
        );
        let onAbort!: () => void;
        const aborted = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(controller.signal.reason ?? new Error("Evaluation cancelled"));
          controller.signal.addEventListener("abort", onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });
        try {
          await Promise.race([
            aborted,
            (async () => {
              controller.signal.throwIfAborted();
              adapter = await options.runCase(context);
              controller.signal.throwIfAborted();
              checks = { ...(await options.check(context)) };
              controller.signal.throwIfAborted();
              if (
                !checks ||
                !Object.keys(checks).length ||
                Object.values(checks).some((value) => typeof value !== "boolean")
              )
                throw new Error("External acceptance must return nonempty boolean criteria.");
              if (!["completed", "failed"].includes(adapter.status))
                throw new Error("Adapter returned an invalid execution status.");
              status =
                adapter.status === "failed"
                  ? "failed"
                  : Object.values(checks).every(Boolean)
                    ? "accepted"
                    : "rejected";
              error = adapter.error;
            })(),
          ]);
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
          if (controller.signal.aborted) status = options.signal?.aborted ? "cancelled" : "timeout";
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", onAbort);
          options.signal?.removeEventListener("abort", abort);
        }
        const usage = adapter?.usage;
        const outcome: EvaluationOutcome = {
          runId,
          caseId: item.id,
          configuration,
          repetition,
          workspace,
          status,
          checks,
          durationMs: performance.now() - started,
          usage:
            usage &&
            Number.isSafeInteger(usage.inputTokens) &&
            usage.inputTokens >= 0 &&
            Number.isSafeInteger(usage.outputTokens) &&
            usage.outputTokens >= 0
              ? { ...usage }
              : null,
          error,
        };
        outcomes.push(outcome);
        await log({
          type: "attempt.finished",
          ...outcome,
          trace: Array.isArray(adapter?.trace)
            ? adapter.trace
                .filter((event) => typeof event === "string")
                .slice(0, 100)
                .map((event) => event.slice(0, 2000))
            : [],
        });
        if (status === "timeout" || status === "cancelled") {
          stoppedReason =
            "An attempt was aborted; inspect adapter termination and retained effects before continuing.";
          break campaign;
        }
      }
    }
  }
  const report = {
    manifestSha256,
    scheduledRuns,
    attemptedRuns: outcomes.length,
    notAttemptedRuns: scheduledRuns - outcomes.length,
    outcomes,
    stoppedReason,
  };
  await writeFile(path.join(options.outputDirectory, "results.json"), sanitize(report), {
    mode: 0o600,
  });
  return JSON.parse(sanitize(report)) as typeof report;
}
