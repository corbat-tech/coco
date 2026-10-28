import { afterEach, describe, expect, it, vi } from "vitest";
import { workCommand } from "./work.js";
import { InMemoryRuntimeSessionStore } from "../../../runtime/runtime-session-store.js";
import { createSessionWorkLedgerAccess } from "../../../runtime/work-ledger.js";
import type { ReplSession } from "../types.js";

function fixture(): ReplSession {
  const store = new InMemoryRuntimeSessionStore();
  store.create({ id: "owner" });
  const ledger = createSessionWorkLedgerAccess(store).forSession("owner");
  ledger.beforeTool("write_file", { path: "README.md" }, "write", false, "provider-call");
  return {
    id: "owner",
    startedAt: new Date(),
    messages: [],
    projectPath: "/tmp/project",
    trustedTools: new Set(),
    workLedger: ledger.read(),
    config: {
      provider: { type: "openai", model: "fixture", maxTokens: 1024 },
      agent: { systemPrompt: "fixture", maxToolIterations: 10, confirmDestructive: true },
      ui: { theme: "dark", showTimestamps: false, maxHistorySize: 100, showDiff: "on_request" },
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("human work reconciliation", () => {
  it("shows uncertain evidence identity and records an inspected observation without executing tools", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const session = fixture();
    const id = session.workLedger!.evidence[0]!.id;
    await workCommand.execute([], session);
    expect(output.mock.calls.flat().join(" ")).toContain(id);
    await workCommand.execute(["resolve", id, "not-applied", "Inspected", "file"], session);
    expect(session.workLedger!.evidence[0]).toMatchObject({
      phase: "completed",
      kind: "observation",
      success: false,
    });
    expect(session.messages).toEqual([]);
    await expect(workCommand.execute(["resolve", id, "applied", "again"], session)).rejects.toThrow(
      "uncertain",
    );
  });
  it("requires an explicit outcome and inspection reason", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const session = fixture();
    const id = session.workLedger!.evidence[0]!.id;
    await workCommand.execute(["resolve", id, "applied"], session);
    expect(session.workLedger!.evidence[0]?.phase).toBe("running");
    await workCommand.execute(["resolve", id, "invented", "reason"], session);
    expect(session.workLedger!.evidence[0]?.phase).toBe("running");
  });
});
