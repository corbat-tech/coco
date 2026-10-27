import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "./agent-runtime.js";
import {
  createRuntimeSessionStore,
  createFileRuntimeSessionStore,
} from "./runtime-session-store.js";
import { ToolRegistry } from "../tools/registry.js";
import { readPlanTool, updatePlanTool } from "../tools/work-plan.js";
import {
  createSessionWorkLedgerAccess,
  deriveWorkOutcome,
  formatWorkLedger,
  isVerificationTool,
} from "./work-ledger.js";

function fixture() {
  const store = createRuntimeSessionStore();
  store.create({ id: "first" });
  store.create({ id: "second" });
  const access = createSessionWorkLedgerAccess(store);
  return { store, first: access.forSession("first"), second: access.forSession("second") };
}

describe("session work ledger", () => {
  it("retains observed effects and unknown outcomes across a real store reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-work-reopen-"));
    try {
      const path = join(dir, "sessions.json");
      const store = createFileRuntimeSessionStore(path);
      store.create({ id: "session" });
      const ledger = createSessionWorkLedgerAccess(store).forSession("session");
      ledger.update({
        steps: [{ id: "a", description: "Preserve user correction", status: "pending" }],
      });
      ledger.beforeTool("edit_file", { path: "src/a.ts" }, "destructive", false, "write");
      ledger.recordTool({
        toolCallId: "write",
        toolName: "edit_file",
        input: { path: "src/a.ts" },
        success: true,
      });
      ledger.beforeTool(
        "bash_exec",
        { command: "custom effect" },
        "destructive",
        false,
        "uncertain",
      );
      const reopened = createSessionWorkLedgerAccess(createFileRuntimeSessionStore(path))
        .forSession("session")
        .read();
      expect(reopened.items[0]?.description).toBe("Preserve user correction");
      expect(reopened.evidence).toMatchObject([
        { toolCallId: "write", phase: "completed", success: true },
        { toolCallId: "uncertain", phase: "running" },
      ]);
      expect(formatWorkLedger(reopened)).toContain("src/a.ts");
      expect(formatWorkLedger(reopened)).toContain("uncertain");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("preserves pending work during steering and rejects invented evidence", () => {
    const { first, second } = fixture();
    first.update({ steps: [{ id: "a", description: "Implement", status: "pending" }] });
    first.update({ steps: [{ id: "b", description: "User correction", status: "pending" }] });
    expect(first.read().items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(second.read().items).toEqual([]);
    expect(() =>
      first.update({
        steps: [
          { id: "a", description: "Implement", status: "completed", evidenceIds: ["invented"] },
        ],
      }),
    ).toThrow(/Unknown verification/);
    expect(() => first.update({ steps: [], expectedRevision: 0 })).toThrow(/changed/);
  });

  it("distinguishes claims, failed checks, current observed checks and checks made stale by edits", () => {
    const { first } = fixture();
    const step = { id: "a", description: "Implement", status: "completed" as const };
    first.update({ steps: [step] });
    expect(deriveWorkOutcome(first.read())).toBe("completed_unverified");
    first.beforeTool("bash_exec", { command: "node --test" }, "destructive", false, "test-fail");
    first.recordTool({
      toolCallId: "test-fail",
      toolName: "bash_exec",
      input: { command: "node --test" },
      success: true,
      output: { exitCode: 1 },
    });
    const failed = first.read().evidence[0]!;
    first.update({ steps: [{ ...step, evidenceIds: [failed.id] }] });
    expect(deriveWorkOutcome(first.read())).toBe("completed_unverified");
    first.beforeTool("bash_exec", { command: "node --test" }, "destructive", false, "test-ok");
    first.recordTool({
      toolCallId: "test-ok",
      toolName: "bash_exec",
      input: { command: "node --test" },
      success: true,
      output: { exitCode: 0 },
    });
    const receipt = first.read().evidence.at(-1)!;
    first.update({ steps: [{ ...step, evidenceIds: [receipt.id] }] });
    expect(deriveWorkOutcome(first.read())).toBe("verified");
    first.beforeTool("edit_file", { path: "src/api.ts" }, "destructive", false, "edit");
    expect(deriveWorkOutcome(first.read())).toBe("completed_unverified");
    expect(formatWorkLedger(first.read())).toContain("src/api.ts");
    expect(formatWorkLedger(first.read())).toContain("outcome unknown");
  });

  it.each([
    "echo all tests passed",
    "node --test; echo passed",
    "node --test && touch src/a.ts",
    "node --test --help",
    "pnpm test -- --help",
    "vitest run --version",
  ])("never treats arbitrary/composed command %s as verification", (command) => {
    expect(isVerificationTool("bash_exec", { command })).toBe(false);
  });

  it("requires an observed exit/status protocol, not success text or a remote tool name", () => {
    const { first } = fixture();
    first.update({ steps: [{ id: "a", description: "Implement", status: "completed" }] });
    first.beforeTool("bash_exec", { command: "node --test" }, "destructive", false, "test");
    first.recordTool({
      toolCallId: "test",
      toolName: "bash_exec",
      input: { command: "node --test" },
      success: true,
      output: "all tests passed",
    });
    expect(first.read().evidence[0]?.success).toBe(false);
    expect(isVerificationTool("run_tests", {}, true)).toBe(false);
  });

  it("never prunes an unresolved effect while retaining a bounded history", () => {
    const { first } = fixture();
    first.beforeTool("edit_file", { path: "important.ts" }, "destructive", false, "uncertain");
    for (let i = 0; i < 140; i++) {
      first.beforeTool("edit_file", { path: `file-${i}.ts` }, "destructive", false, `edit-${i}`);
      first.recordTool({
        toolCallId: `edit-${i}`,
        toolName: "edit_file",
        input: { path: `file-${i}.ts` },
        success: true,
      });
    }
    expect(first.read().evidence).toHaveLength(128);
    expect(first.read().evidence.some((item) => item.toolCallId === "uncertain")).toBe(true);
    expect(formatWorkLedger(first.read())).toContain("important.ts");
  });

  it("wires real plan tools through runtime consent and records the real dispatch result", async () => {
    const registry = new ToolRegistry();
    registry.register(readPlanTool);
    registry.register(updatePlanTool);
    registry.register({
      name: "bash_exec",
      category: "bash",
      description: "fixture test",
      parameters: z.object({ command: z.string() }),
      execute: async () => ({ exitCode: 0 }),
    });
    const runtime = new AgentRuntime({ providerType: "openai", toolRegistry: registry });
    const session = runtime.createSession({ mode: "build" });
    try {
      const plan = await runtime.executeTool({
        sessionId: session.id,
        toolName: "update_plan",
        input: { steps: [{ id: "test", description: "Test", status: "in_progress" }] },
      });
      expect(plan.success).toBe(true);
      const denied = await runtime.executeTool({
        sessionId: session.id,
        toolName: "bash_exec",
        input: { command: "node --test" },
      });
      expect(denied.success).toBe(false);
      const before = await runtime.executeTool({
        sessionId: session.id,
        toolName: "read_plan",
        input: {},
      });
      expect((before.output as { evidence: unknown[] }).evidence).toEqual([]);
      await runtime.executeTool({
        sessionId: session.id,
        toolCallId: "actual-check",
        toolName: "bash_exec",
        confirmed: true,
        input: { command: "node --test" },
      });
      const after = await runtime.executeTool({
        sessionId: session.id,
        toolName: "read_plan",
        input: {},
      });
      const evidence = (after.output as { evidence: Array<{ id: string; toolCallId: string }> })
        .evidence;
      expect(evidence[0]?.toolCallId).toBe("actual-check");
      const completed = await runtime.executeTool({
        sessionId: session.id,
        toolName: "update_plan",
        input: {
          steps: [
            {
              id: "test",
              description: "Test",
              status: "completed",
              evidenceIds: [evidence[0]!.id],
            },
          ],
        },
      });
      expect((completed.output as { outcome: string }).outcome).toBe("verified");
      const other = runtime.createSession({ mode: "build" });
      const isolated = await runtime.executeTool({
        sessionId: other.id,
        toolName: "read_plan",
        input: {},
      });
      expect((isolated.output as { items: unknown[] }).items).toEqual([]);
    } finally {
      await runtime.close();
    }
  });
});
