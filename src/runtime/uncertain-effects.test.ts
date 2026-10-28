import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry.js";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";
import { createRuntimeSessionStore } from "./runtime-session-store.js";
import { createSessionWorkLedgerAccess, reconcileWorkEvidence } from "./work-ledger.js";
import type { RuntimeToolExecutionResult } from "./types.js";

function fixture() {
  const store = createRuntimeSessionStore();
  store.create({ id: "uncertain", mode: "build" });
  store.create({ id: "clean", mode: "build" });
  const access = createSessionWorkLedgerAccess(store);
  for (const id of ["uncertain", "clean"])
    access
      .forSession(id)
      .update({ steps: [{ id: "work", description: "Inspect then edit", status: "pending" }] });
  const registry = new ToolRegistry();
  const effect = vi.fn(async () => "applied");
  registry.register({
    name: "write_file",
    description: "Observable fixture mutation",
    category: "file",
    parameters: z.object({}),
    execute: effect,
  });
  registry.register({
    name: "read_file",
    description: "Fixture host inspection with nested dispatch",
    category: "file",
    parameters: z.object({}),
    execute: async (_input, context) =>
      context!.executeDelegatedTool!({
        toolName: "write_file",
        input: {},
        mode: "build",
        allowedTools: ["write_file"],
        toolCallId: "reused-provider-id",
      }),
  });
  const executor = new RuntimeToolExecutor({ toolRegistry: registry, workLedgerAccess: access });
  return { access, effect, executor };
}

describe("uncertain effects retain host-owned execution identity", () => {
  it("a live read cannot hide an old uncertain write by reusing its provider ID", async () => {
    const f = fixture();
    const ledger = f.access.forSession("uncertain");
    ledger.beforeTool("write_file", {}, "write", false, "reused-provider-id");
    const original = ledger.read().evidence[0]!;
    const read = await f.executor.execute({
      sessionId: "uncertain",
      mode: "build",
      toolName: "read_file",
      toolCallId: "reused-provider-id",
      input: {},
      approveDelegatedTool: async () => true,
    });
    expect(read.success).toBe(true);
    expect((read.output as RuntimeToolExecutionResult).success).toBe(false);
    expect((read.output as RuntimeToolExecutionResult).error).toContain("uncertain");
    expect(f.effect).not.toHaveBeenCalled();
    expect(ledger.read().evidence.find((entry) => entry.id === original.id)).toMatchObject({
      toolName: "write_file",
      phase: "running",
      toolCallId: "reused-provider-id",
    });
    const inspected = ledger.read().evidence.find((entry) => entry.toolName === "read_file")!;
    expect(inspected.hostExecutionId).toEqual(expect.any(String));
    expect(inspected.phase).toBe("completed");
  });

  it("legitimate active nested calls and another session remain independent", async () => {
    const f = fixture();
    f.access
      .forSession("uncertain")
      .beforeTool("write_file", {}, "write", false, "reused-provider-id");
    const read = await f.executor.execute({
      sessionId: "clean",
      mode: "build",
      toolName: "read_file",
      toolCallId: "reused-provider-id",
      input: {},
      approveDelegatedTool: async () => true,
    });
    expect((read.output as RuntimeToolExecutionResult).success).toBe(true);
    expect(f.effect).toHaveBeenCalledOnce();
    const clean = f.access.forSession("clean").read();
    expect(clean.evidence.every((entry) => entry.phase === "completed")).toBe(true);
    expect(new Set(clean.evidence.map((entry) => entry.hostExecutionId)).size).toBe(2);
    expect(clean.evidence.every((entry) => entry.toolCallId === "reused-provider-id")).toBe(true);
    const foreign = f.access.forSession("uncertain").read().evidence[0]!;
    expect(() =>
      reconcileWorkEvidence(clean, {
        evidenceId: foreign.id,
        outcome: "applied",
        reason: "Wrong session",
      }),
    ).toThrow("uncertain evidence ID");
    expect(f.access.forSession("uncertain").read().evidence[0]?.phase).toBe("running");
  });
});
