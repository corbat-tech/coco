import { mkdtemp, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeSpecialistPlan } from "./specialist-plan.js";
import { delegateTaskTool } from "./agent-coordinator.js";
import { ToolRegistry } from "./registry.js";
import { RuntimeToolExecutor } from "../runtime/runtime-tool-executor.js";
import { normalizeAgentRunResult } from "../runtime/multi-agent.js";
import type { RunAgent, ToolExecutionContext } from "./execution-context.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const readers = [
  {
    id: "inspect",
    profile: "explore" as const,
    objective: "Inspect",
    acceptance: ["Find references"],
    resources: { reads: ["src/a.ts"], writes: [] },
  },
];
const writers = [
  {
    id: "edit",
    profile: "docs" as const,
    objective: "Document",
    acceptance: ["File updated"],
    resources: { reads: [], writes: ["README.md"] },
  },
];

describe("structured plans through the existing delegation tool", () => {
  it("rejects an unbound plan and never falls back to the global provider", async () => {
    await expect(executeSpecialistPlan(readers, undefined)).rejects.toThrow("host-bound");
  });
  it("binds each plan to its current parent context even when the worker callback is reused", async () => {
    const first = vi.fn(async () => ({
      toolName: "read_file",
      success: true,
      duration: 0,
      decision: { allowed: true, risk: "read-only" as const },
    }));
    const second = vi.fn(async () => ({
      toolName: "read_file",
      success: false,
      error: "narrow parent",
      duration: 0,
      decision: { allowed: false, risk: "read-only" as const },
    }));
    const runAgent: RunAgent = async (request, context) => {
      expect(request.validatedPlan).toBe(true);
      const result = await context.executeDelegatedTool!({
        toolName: "read_file",
        input: { path: "src/a.ts" },
        mode: "plan",
        allowedTools: ["read_file"],
      });
      return normalizeAgentRunResult({
        id: "worker",
        taskId: "child",
        role: "researcher",
        success: result.success,
        output: context.sessionId ?? "",
        error: result.error,
      });
    };
    Object.assign(runAgent, { delegation: { message: "Use @explore", mode: "manual" } });
    const a = await executeSpecialistPlan(readers, {
      runAgent,
      sessionId: "a",
      executeDelegatedTool: first,
    });
    const b = await executeSpecialistPlan(readers, {
      runAgent,
      sessionId: "b",
      executeDelegatedTool: second,
    });
    expect(a.graphResult?.status).toBe("completed");
    expect(b.graphResult?.status).toBe("failed");
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(b.acceptance).toBe("unverified");
  });
  it("classifies plan mutations from all assignments, not a misleading outer role", async () => {
    const registry = new ToolRegistry();
    registry.register(delegateTaskTool);
    const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
    const runAgent = vi.fn<RunAgent>();
    const result = await runtime.execute({
      toolName: "delegateTask",
      mode: "plan",
      confirmed: true,
      runAgent,
      input: { taskId: "x", task: "Inspect", agentType: "explore", assignments: writers },
    });
    expect(result.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });
  it("performs only assigned file writes through exact host approval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coco-plan-"));
    temporary.push(root);
    const registry = new ToolRegistry();
    registry.register(delegateTaskTool);
    const effect = vi.fn(async (input: { path: string; content: string }) => {
      await writeFile(path.resolve(root, input.path), input.content);
      return { written: true };
    });
    registry.register({
      name: "write_file",
      description: "fixture",
      category: "file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: effect,
    });
    const runtime = new RuntimeToolExecutor({ toolRegistry: registry });
    const runAgent: RunAgent = Object.assign(
      async (_request: Parameters<RunAgent>[0], context: ToolExecutionContext) => {
        await expect(
          context.executeDelegatedTool!({
            toolName: "bash_exec",
            input: { command: "touch other" },
            mode: "build",
            allowedTools: ["bash_exec"],
          }),
        ).rejects.toThrow("cannot bound");
        await expect(
          context.executeDelegatedTool!({
            toolName: "write_file",
            input: { path: "OTHER.md", content: "bad" },
            mode: "build",
            allowedTools: ["write_file"],
          }),
        ).rejects.toThrow("outside its assigned");
        const result = await context.executeDelegatedTool!({
          toolName: "write_file",
          input: { path: "README.md", content: "observed" },
          mode: "build",
          allowedTools: ["write_file"],
        });
        return normalizeAgentRunResult({
          id: "worker",
          taskId: "worker",
          role: "docs",
          success: result.success,
          output: "edited",
          error: result.error,
        });
      },
      { projectRoot: root, delegation: { message: "Use @docs", mode: "manual" as const } },
    );
    const result = await runtime.execute({
      toolName: "delegateTask",
      mode: "build",
      confirmed: true,
      runAgent,
      approveDelegatedTool: async () => true,
      input: { taskId: "x", task: "Document", assignments: writers },
    });
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      graphResult: { status: "completed" },
      acceptance: "unverified",
    });
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("observed");
    expect(effect).toHaveBeenCalledOnce();
  });
  it("blocks symlink writes outside the host root even when declared in an assignment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coco-scope-"));
    temporary.push(root);
    const outside = await mkdtemp(path.join(tmpdir(), "coco-outside-"));
    temporary.push(outside);
    await symlink(outside, path.join(root, "link"));
    const original = vi.fn();
    const runAgent: RunAgent = Object.assign(
      async (_request: Parameters<RunAgent>[0], context: ToolExecutionContext) => {
        await expect(
          context.executeDelegatedTool!({
            toolName: "write_file",
            input: { path: "link/secret.md" },
            mode: "build",
            allowedTools: ["write_file"],
          }),
        ).rejects.toThrow();
        return normalizeAgentRunResult({
          id: "worker",
          taskId: "worker",
          role: "docs",
          success: false,
          output: "blocked",
        });
      },
      { projectRoot: root, delegation: { message: "Use @docs", mode: "manual" as const } },
    );
    const result = await executeSpecialistPlan(
      [{ ...writers[0]!, resources: { reads: [], writes: ["link/secret.md"] } }],
      { runAgent, executeDelegatedTool: original },
    );
    expect(result.graphResult?.status).toBe("failed");
    expect(original).not.toHaveBeenCalled();
  });
  it("preserves external edits made after the worker's observed file read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coco-precondition-"));
    temporary.push(root);
    await writeFile(path.join(root, "README.md"), "initial");
    const authority = vi.fn(async (call) => ({
      toolName: call.toolName,
      success: true,
      output: { content: "initial" },
      duration: 0,
      decision: { allowed: true, risk: "read-only" as const },
    }));
    const runAgent: RunAgent = Object.assign(
      async (_request: Parameters<RunAgent>[0], context: ToolExecutionContext) => {
        await context.executeDelegatedTool!({
          toolName: "read_file",
          input: { path: "README.md" },
          mode: "build",
          allowedTools: ["read_file"],
        });
        await writeFile(path.join(root, "README.md"), "user update");
        await expect(
          context.executeDelegatedTool!({
            toolName: "write_file",
            input: { path: "README.md", content: "worker update" },
            mode: "build",
            allowedTools: ["write_file"],
          }),
        ).rejects.toThrow("may have changed");
        return normalizeAgentRunResult({
          id: "worker",
          taskId: "child",
          role: "docs",
          success: false,
          output: "conflict",
        });
      },
      { projectRoot: root, delegation: { message: "Use @docs", mode: "manual" as const } },
    );
    await executeSpecialistPlan(writers, { runAgent, executeDelegatedTool: authority });
    expect(authority).toHaveBeenCalledOnce();
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("user update");
  });
});
