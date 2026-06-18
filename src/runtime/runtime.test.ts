import { describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { LLMProvider } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import { createAgentRuntime } from "./agent-runtime.js";
import { createEventLog, createFileEventLog } from "./event-log.js";
import { createMcpToolPolicy } from "./extension-manifests.js";
import { createPermissionPolicy } from "./permission-policy.js";
import { createProviderRegistry } from "./provider-registry.js";
import { createWorkflowCatalog } from "./workflow-registry.js";

function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    initialize: vi.fn(),
    chat: vi.fn(),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn((text: string) => text.length),
    getContextWindow: vi.fn(() => 128000),
    isAvailable: vi.fn(async () => true),
  } as unknown as LLMProvider;
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "read_file",
      description: "Read a file",
      category: "file",
      parameters: z.object({}),
      execute: async () => "ok",
    }),
  );
  registry.register(
    defineTool({
      name: "write_file",
      description: "Write a file",
      category: "file",
      parameters: z.object({}),
      execute: async () => "ok",
    }),
  );
  registry.register(
    defineTool({
      name: "authorize_path",
      description: "Authorize a filesystem path",
      category: "config",
      parameters: z.object({}),
      execute: async () => "ok",
    }),
  );
  registry.register(
    defineTool({
      name: "run_linter",
      description: "Run linter, optionally with fixes",
      category: "quality",
      parameters: z.object({}),
      execute: async () => "ok",
    }),
  );
  return registry;
}

describe("reusable agent runtime", () => {
  it("exposes provider catalog capabilities through the provider registry", () => {
    const registry = createProviderRegistry();
    const cap = registry.getCapability("openai", "gpt-5.4");

    expect(registry.getDefaultModel("openai")).toBeTruthy();
    expect(cap.endpoint).toBe("openai-responses");
    expect(cap.supportsReasoning).toBe(true);
    expect(registry.listModels("openai").some((model) => model.id === "gpt-5.4")).toBe(true);
  });

  it("records runtime initialization and exposes a reusable snapshot", async () => {
    const eventLog = createEventLog();
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
      eventLog,
    });

    const snapshot = runtime.snapshot();

    expect(snapshot.provider.capability.endpoint).toBe("openai-responses");
    expect(snapshot.tools.names).toEqual([
      "authorize_path",
      "read_file",
      "run_linter",
      "write_file",
    ]);
    expect(snapshot.modes.map((mode) => mode.id)).toContain("architect");
    expect(eventLog.list().map((event) => event.type)).toEqual([
      "provider.attached",
      "runtime.initialized",
    ]);
  });

  it("does not publish to the global bridge by default", async () => {
    const runtime = await createAgentRuntime({
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
    });

    expect(runtime.snapshot().provider.model).toBe("gpt-5.4");
  });

  it("enforces read-only mode permissions without blocking build mode writes", async () => {
    const runtime = await createAgentRuntime({
      providerType: "anthropic",
      model: "claude-sonnet-4-6",
      provider: createMockProvider(),
      toolRegistry: createRegistry(),
    });

    expect(runtime.assertToolAllowed("plan", "read_file")).toBe(true);
    expect(runtime.assertToolAllowed("plan", "write_file")).toBe(false);
    expect(runtime.assertToolAllowed("plan", "authorize_path")).toBe(false);
    expect(runtime.assertToolAllowed("plan", "run_linter")).toBe(false);
    expect(runtime.assertToolAllowed("build", "write_file")).toBe(true);
    expect(runtime.assertToolAllowed("build", "run_linter")).toBe(true);
  });

  it("marks destructive tools as confirmation-worthy", () => {
    const registry = createRegistry();
    const tool = registry.get("write_file");
    const policy = createPermissionPolicy();

    expect(tool).toBeDefined();
    expect(policy.canExecuteTool("build", tool!).requiresConfirmation).toBe(true);
  });

  it("creates conservative MCP tool policies for sensitive tools", () => {
    const policy = createMcpToolPolicy("github", "delete_branch", "destructive");

    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.allowedModes).toContain("review");
  });

  it("persists runtime events to jsonl when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-"));
    const eventLogPath = join(dir, "events.jsonl");
    const log = createFileEventLog(eventLogPath);

    log.record("runtime.initialized", { provider: "openai" });
    log.record("tool.blocked", { tool: "write_file" });

    const raw = await readFile(eventLogPath, "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(log.list().map((event) => event.type)).toEqual(["runtime.initialized", "tool.blocked"]);
  });

  it("falls back to in-memory events after file writes fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-runtime-"));
    const eventLogPath = join(dir, "events.jsonl");
    const log = createFileEventLog(eventLogPath);

    log.record("runtime.initialized", { provider: "openai" });

    await chmod(eventLogPath, 0o444);
    try {
      log.record("tool.blocked", { tool: "write_file" });

      expect(log.list().map((event) => event.type)).toEqual([
        "runtime.initialized",
        "tool.blocked",
      ]);
      expect(log.count()).toBe(2);
    } finally {
      await chmod(eventLogPath, 0o644);
    }
  });

  it("exposes reusable workflow definitions and records planned plans", () => {
    const eventLog = createEventLog();
    const catalog = createWorkflowCatalog();

    expect(catalog.list().map((workflow) => workflow.id)).toContain("architect-editor-verifier");
    expect(catalog.get("release")?.checks).toContain("release.yml");
    expect(catalog.get("release")?.steps.find((step) => step.id === "publish")?.risk).toBe(
      "destructive",
    );
    expect(catalog.get("provider-diagnosis")?.steps[0]?.requiredTools).toEqual([]);

    const plan = catalog.createPlan("provider-diagnosis", { provider: "openai" }, eventLog);

    expect(plan.status).toBe("planned");
    expect(eventLog.list().map((event) => event.type)).toContain("workflow.planned");
  });

  it("returns defensive copies of workflow definitions", () => {
    const catalog = createWorkflowCatalog();
    const workflow = catalog.get("release")!;

    workflow.checks.push("mutated");
    workflow.steps[0]!.requiredTools.push("mutated_tool");

    expect(catalog.get("release")?.checks).not.toContain("mutated");
    expect(catalog.get("release")?.steps[0]?.requiredTools).not.toContain("mutated_tool");
  });
});
