import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RuntimeSessionStore } from "./types.js";

const WorkItemSchema = z.object({
  id: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  evidenceIds: z.array(z.string().max(100)).max(32).default([]),
  blockedReason: z.string().max(500).optional(),
});
const EvidenceSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  hostExecutionId: z.string().optional(),
  toolName: z.string(),
  kind: z.enum(["check", "observation"]),
  phase: z.enum(["running", "completed"]),
  success: z.boolean(),
  exitCode: z.number().optional(),
  mutationRevision: z.number().int().nonnegative(),
  summary: z.string().max(600),
  createdAt: z.string(),
});
export const WorkLedgerSchema = z.object({
  version: z.literal(1),
  planRevision: z.number().int().nonnegative(),
  mutationRevision: z.number().int().nonnegative(),
  items: z.array(WorkItemSchema).max(64),
  evidence: z.array(EvidenceSchema).max(128),
});
export const WorkPlanUpdateSchema = z.object({
  steps: z.array(WorkItemSchema).max(64),
  removeIds: z.array(z.string().max(80)).max(64).default([]),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export type WorkLedgerState = z.infer<typeof WorkLedgerSchema>;
export type WorkPlanUpdate = z.input<typeof WorkPlanUpdateSchema>;
const WorkResolutionSchema = z.object({
  evidenceId: z.string().min(1),
  outcome: z.enum(["applied", "not-applied"]),
  reason: z.string().trim().min(1).max(500),
});
export type WorkEvidenceResolution = z.input<typeof WorkResolutionSchema>;

/** Host-observed reconciliation. Never replays a tool or manufactures a passing check. */
export function reconcileWorkEvidence(
  state: WorkLedgerState,
  input: WorkEvidenceResolution,
): WorkLedgerState {
  const resolution = WorkResolutionSchema.parse(input);
  const current = WorkLedgerSchema.parse(state);
  const evidence = current.evidence.find((entry) => entry.id === resolution.evidenceId);
  if (!evidence || evidence.phase !== "running")
    throw new Error("Reconciliation must identify an uncertain evidence ID from this session.");
  return {
    ...current,
    evidence: current.evidence.map((entry) =>
      entry.id !== resolution.evidenceId
        ? entry
        : {
            ...entry,
            kind: "observation" as const,
            phase: "completed" as const,
            success: resolution.outcome === "applied",
            summary:
              `[Host reconciliation: ${resolution.outcome}; ${resolution.reason}] ${entry.summary}`.slice(
                0,
                600,
              ),
          },
    ),
  };
}
export type WorkOutcome =
  | "not_planned"
  | "pending"
  | "blocked"
  | "completed_unverified"
  | "verified";

export interface WorkToolOutcome {
  toolCallId: string;
  hostExecutionId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
  remote?: boolean;
}
export interface WorkLedgerHandle {
  read(): WorkLedgerState;
  update(input: WorkPlanUpdate): WorkLedgerState;
  beforeTool(
    toolName: string,
    input: Record<string, unknown>,
    risk: string,
    remote: boolean,
    toolCallId?: string,
    hostExecutionId?: string,
  ): void;
  recordTool(input: WorkToolOutcome): void;
}
export interface WorkLedgerAccess {
  forSession(sessionId: string): WorkLedgerHandle;
}

function retainEvidence(evidence: WorkLedgerState["evidence"]): WorkLedgerState["evidence"] {
  const running = evidence.filter((item) => item.phase === "running");
  if (running.length > 128)
    throw new Error("Too many unresolved tool outcomes; inspect the session before continuing.");
  const slots = 128 - running.length;
  const retained = new Set([
    ...running.map((item) => item.id),
    ...(slots
      ? evidence
          .filter((item) => item.phase === "completed")
          .slice(-slots)
          .map((item) => item.id)
      : []),
  ]);
  return evidence.filter((item) => retained.has(item.id));
}

function describeAction(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command.slice(0, 600);
  const target = input.path ?? input.filePath ?? input.cwd ?? input.pattern;
  return `${toolName}${typeof target === "string" ? ` ${target}` : ""}`.slice(0, 600);
}

/** Read only host-persisted state. A corrupt ledger must not silently erase work. */
export function readWorkLedger(metadata: Record<string, unknown>): WorkLedgerState {
  if (metadata.workLedger === undefined)
    return { version: 1, planRevision: 0, mutationRevision: 0, items: [], evidence: [] };
  return WorkLedgerSchema.parse(metadata.workLedger);
}

/** Identify executed checks conservatively; a successful arbitrary shell is not a test. */
export function isVerificationTool(
  toolName: string,
  input: Record<string, unknown>,
  remote = false,
): boolean {
  if (remote) return false;
  if (["run_tests", "run_test_file", "tsc"].includes(toolName)) return true;
  if (toolName !== "bash_exec" || typeof input.command !== "string") return false;
  const command = input.command.trim();
  // No shell composition, substitutions, redirects or inline interpreters.
  if (/[;&|<>`$\n\r]/.test(command)) return false;
  if (
    /(?:^|\s)(?:--(?:help|version|list(?:Tests)?|dry-run|collect-only|showConfig|show-config|watch)|-h|-v)(?:\s|=|$)/i.test(
      command,
    )
  )
    return false;
  return /^(?:node\s+--test(?:\s|$)|(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test(?::[\w-]+)?|typecheck|lint|check|build)(?:\s|$)|(?:npx\s+)?(?:vitest\s+run|tsc\s+--noEmit)(?:\s|$))/.test(
    command,
  );
}

/** Model completion is a claim; verification requires current, successful observed checks. */
export function deriveWorkOutcome(state: WorkLedgerState): WorkOutcome {
  if (!state.items.length) return "not_planned";
  if (state.items.some((item) => item.status === "blocked")) return "blocked";
  if (state.items.some((item) => item.status !== "completed")) return "pending";
  const verified = state.items.every(
    (item) =>
      item.evidenceIds.length > 0 &&
      item.evidenceIds.every((id) =>
        state.evidence.some(
          (evidence) =>
            evidence.id === id &&
            evidence.kind === "check" &&
            evidence.phase === "completed" &&
            evidence.success &&
            evidence.mutationRevision === state.mutationRevision,
        ),
      ),
  );
  return verified ? "verified" : "completed_unverified";
}

/** Small projection for composed prompts and /work; does not expose command output. */
export function formatWorkLedger(state?: WorkLedgerState): string {
  if (!state || (!state.items.length && !state.evidence.length)) return "";
  const lines = state.items.map(
    (item) =>
      `- [${item.status}] ${item.id}: ${item.description}${item.blockedReason ? ` (${item.blockedReason})` : ""}`,
  );
  const checks = state.evidence
    .filter((evidence) => evidence.kind === "check")
    .slice(-5)
    .map(
      (evidence) =>
        `${evidence.id}: ${evidence.phase === "running" ? "outcome unknown" : evidence.success ? "passed" : "failed"}${evidence.mutationRevision !== state.mutationRevision ? " (stale)" : ""} — ${evidence.summary}`,
    );
  return [
    `## Session work plan (revision ${state.planRevision})`,
    `Outcome: ${deriveWorkOutcome(state)}. Completed steps are claims; checks only establish their observed execution outcome.`,
    ...lines,
    ...(checks.length ? ["Recent observed checks:", ...checks] : []),
    "Recent actual actions (failed or interrupted actions may have partial effects; do not blindly repeat unknown outcomes):",
    ...state.evidence
      .slice(-5)
      .map(
        (evidence) =>
          `${evidence.toolName} [${evidence.phase === "running" ? "outcome unknown" : evidence.success ? "succeeded" : "failed; effects may exist"}]: ${evidence.summary}`,
      ),
    ...(state.evidence.some((evidence) => evidence.phase === "running")
      ? [
          `Unresolved tool outcomes: ${state.evidence
            .filter((evidence) => evidence.phase === "running")
            .slice(0, 8)
            .map((evidence) => `${evidence.id} (call ${evidence.toolCallId}): ${evidence.summary}`)
            .join(
              "; ",
            )}. Inspect before repeating any possibly executed action. Use /work resolve <evidenceId> applied|not-applied <inspection reason> after host inspection.`,
        ]
      : []),
    "Use read_plan/update_plan to inspect evidence, preserve existing pending steps and link real check IDs. Never invent verification.",
  ].join("\n");
}

/** Bind plans and observed evidence to the host-selected session, never model arguments. */
export function createSessionWorkLedgerAccess(store: RuntimeSessionStore): WorkLedgerAccess {
  return {
    forSession(sessionId) {
      const getSession = () => {
        const session = store.get(sessionId);
        if (!session) throw new Error(`Work plan session not found: ${sessionId}`);
        return session;
      };
      const read = () => readWorkLedger(getSession().metadata);
      const change = (update: (state: WorkLedgerState) => WorkLedgerState) => {
        const session = getSession();
        const state = WorkLedgerSchema.parse(update(readWorkLedger(session.metadata)));
        store.update({ ...session, metadata: { ...session.metadata, workLedger: state } });
        return state;
      };
      return {
        read,
        update(raw) {
          const input = WorkPlanUpdateSchema.parse(raw);
          return change((state) => {
            if (
              input.expectedRevision !== undefined &&
              input.expectedRevision !== state.planRevision
            )
              throw new Error("Work plan changed; read_plan and retry with the current revision.");
            const ids = input.steps.map((item) => item.id);
            if (new Set(ids).size !== ids.length) throw new Error("Duplicate work step ID");
            if (input.removeIds.some((id) => ids.includes(id)))
              throw new Error("A work step cannot be updated and removed together");
            for (const item of input.steps) {
              for (const id of item.evidenceIds) {
                if (!state.evidence.some((evidence) => evidence.id === id))
                  throw new Error(
                    `Unknown verification evidence: ${id}. Use read_plan for observed IDs.`,
                  );
              }
            }
            const items = new Map(
              state.items
                .filter((item) => !input.removeIds.includes(item.id))
                .map((item) => [item.id, item]),
            );
            for (const item of input.steps) items.set(item.id, item);
            return { ...state, planRevision: state.planRevision + 1, items: [...items.values()] };
          });
        },
        beforeTool(toolName, input, risk, remote, toolCallId = randomUUID(), hostExecutionId) {
          if (["read_plan", "update_plan"].includes(toolName) && !remote) return;
          if (
            risk === "read-only" &&
            !isVerificationTool(toolName, input, remote) &&
            !read().items.length
          )
            return;
          change((state) => {
            const mutationRevision = state.mutationRevision + (risk !== "read-only" ? 1 : 0);
            return {
              ...state,
              mutationRevision,
              evidence: retainEvidence([
                ...state.evidence,
                {
                  id: `ev_${randomUUID()}`,
                  toolCallId,
                  ...(hostExecutionId ? { hostExecutionId } : {}),
                  toolName,
                  kind: isVerificationTool(toolName, input, remote)
                    ? ("check" as const)
                    : ("observation" as const),
                  phase: "running" as const,
                  success: false,
                  mutationRevision,
                  summary: describeAction(toolName, input),
                  createdAt: new Date().toISOString(),
                },
              ]),
            };
          });
        },
        recordTool(outcome) {
          if (["read_plan", "update_plan"].includes(outcome.toolName) && !outcome.remote) return;
          if (
            !read().items.length &&
            !read().evidence.some(
              (item) =>
                (outcome.hostExecutionId
                  ? item.hostExecutionId === outcome.hostExecutionId
                  : item.toolCallId === outcome.toolCallId) &&
                item.toolName === outcome.toolName &&
                item.phase === "running",
            )
          )
            return;
          change((state) => {
            const output =
              outcome.output && typeof outcome.output === "object"
                ? (outcome.output as Record<string, unknown>)
                : undefined;
            const exitCode = typeof output?.exitCode === "number" ? output.exitCode : undefined;
            const check = isVerificationTool(outcome.toolName, outcome.input, outcome.remote);
            const protocolSuccess =
              exitCode !== undefined
                ? exitCode === 0
                : typeof output?.success === "boolean"
                  ? output.success
                  : false;
            const success =
              outcome.success &&
              (check
                ? protocolSuccess
                : output?.success !== false && (exitCode === undefined || exitCode === 0));
            const summary = describeAction(outcome.toolName, outcome.input);
            const previous = [...state.evidence]
              .reverse()
              .find(
                (item) =>
                  (outcome.hostExecutionId
                    ? item.hostExecutionId === outcome.hostExecutionId
                    : item.toolCallId === outcome.toolCallId) &&
                  item.toolName === outcome.toolName &&
                  item.phase === "running",
              );
            const evidence = {
              id: previous?.id ?? `ev_${randomUUID()}`,
              toolCallId: outcome.toolCallId,
              ...(previous?.hostExecutionId ? { hostExecutionId: previous.hostExecutionId } : {}),
              toolName: outcome.toolName,
              kind: check ? ("check" as const) : ("observation" as const),
              phase: "completed" as const,
              success,
              exitCode,
              mutationRevision: previous?.mutationRevision ?? state.mutationRevision,
              summary: summary.slice(0, 600),
              createdAt: previous?.createdAt ?? new Date().toISOString(),
            };
            return {
              ...state,
              evidence: previous
                ? state.evidence.map((item) => (item.id === previous.id ? evidence : item))
                : retainEvidence([...state.evidence, evidence]),
            };
          });
        },
      };
    },
  };
}
