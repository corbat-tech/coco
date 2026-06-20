import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../providers/types.js";
import { defineTool, ToolRegistry } from "../tools/registry.js";
import {
  createCodingToolRegistry,
  createNoToolRegistry,
  createPublicWebToolRegistry,
  createRagToolRegistry,
  createInternalOpsToolRegistry,
  createSalesIntakeToolRegistry,
  createSupportRagToolRegistry,
} from "../tools/profiles.js";
import { createHttpAssistantAdapter, createWebhookAssistantAdapter } from "../adapters/index.js";
import {
  publicWebsiteAssistantPreset,
  internalOpsAssistantPreset,
  ragKnowledgeAssistantPreset,
  salesIntakeAssistantPreset,
  supportRagAssistantPreset,
} from "../presets/index.js";
import {
  createAgentFromBlueprint,
  createBaseBlueprint,
  createInMemoryKnowledgeRetriever,
  defaultPublicGuardrails,
  runGuardrails,
} from "./index.js";
import { z } from "zod";

function createMockProvider(): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    initialize: vi.fn(),
    chat: vi.fn(async () => ({
      id: "chat-1",
      content: "assistant reply",
      stopReason: "end_turn",
      usage: { inputTokens: 2, outputTokens: 3 },
      model: "mock-model",
    })),
    chatWithTools: vi.fn(),
    stream: vi.fn(async function* () {
      yield { type: "text", text: "assistant " };
      yield { type: "text", text: "reply" };
      yield { type: "done", stopReason: "end_turn" };
    }),
    streamWithTools: vi.fn(),
    countTokens: vi.fn((text: string) => text.length),
    getContextWindow: vi.fn(() => 128000),
    isAvailable: vi.fn(async () => true),
  } as unknown as LLMProvider;
}

function createSourceRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "search_public_docs",
      description: "Search public docs",
      category: "search",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ query, hits: [] }),
    }),
  );
  registry.register(
    defineTool({
      name: "bash_exec",
      description: "Run shell",
      category: "bash",
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => ({ command }),
    }),
  );
  return registry;
}

describe("agent platform layer", () => {
  it("creates safe tool profiles without leaking coding tools to public assistants", () => {
    expect(createNoToolRegistry().getAll()).toEqual([]);

    const publicRegistry = createPublicWebToolRegistry(createSourceRegistry());
    expect(publicRegistry.getAll().map((tool) => tool.name)).toEqual(["search_public_docs"]);
    expect(publicRegistry.has("bash_exec")).toBe(false);

    const codingRegistry = createCodingToolRegistry();
    expect(codingRegistry.has("bash_exec")).toBe(true);
    expect(codingRegistry.has("write_file")).toBe(true);
  });

  it("runs public guardrails with redaction and blocking", () => {
    const redacted = runGuardrails(
      "input",
      "token sk-abcdefghijklmnopqrstuvwxyz1234567890",
      defaultPublicGuardrails,
    );
    expect(redacted.allowed).toBe(true);
    expect(redacted.content).toContain("[REDACTED]");
    expect(redacted.findings.some((finding) => finding.redacted)).toBe(true);

    const blocked = runGuardrails("input", "x".repeat(20), { maxInputChars: 10 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.findings[0]?.id).toBe("input-too-long");
  });

  it("creates a blueprint-backed assistant with ask mode and no tools by default", async () => {
    const blueprint = createBaseBlueprint({
      id: "test-assistant",
      name: "Test Assistant",
      description: "Test",
      surface: "web",
      defaultMode: "ask",
      maturity: "experimental",
      instructions: "Answer safely.",
      allowedTools: [],
    });

    const assistant = await createAgentFromBlueprint(blueprint, {
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
    });
    const session = assistant.createSession({ tenantId: "test" });
    const result = await assistant.runTurn({ sessionId: session.id, content: "hello" });

    expect(session.mode).toBe("ask");
    expect(assistant.runtime.snapshot().tools.count).toBe(0);
    expect(result.content).toBe("assistant reply");
    expect(assistant.runtime.eventLog.list().map((event) => event.type)).toContain(
      "guardrail.input",
    );
  });

  it("defines reusable presets with conservative defaults", async () => {
    const publicBlueprint = publicWebsiteAssistantPreset.createBlueprint({ brand: "Corbat" });
    expect(publicBlueprint.surface).toBe("web");
    expect(publicBlueprint.defaultMode).toBe("ask");
    expect(publicBlueprint.allowedTools).toEqual([]);

    const salesBlueprint = salesIntakeAssistantPreset.createBlueprint({ brand: "Corbat" });
    expect(salesBlueprint.instructions).toContain("budget");
    expect(salesBlueprint.instructions).toContain("next step");

    const runtime = await publicWebsiteAssistantPreset.createRuntime({
      brand: "Corbat",
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
    });
    expect(runtime.snapshot().tools.names).toEqual([]);

    const filteredRuntime = await publicWebsiteAssistantPreset.createRuntime({
      brand: "Corbat",
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      toolRegistry: createSourceRegistry(),
    });
    expect(filteredRuntime.snapshot().tools.names).toEqual([]);
  });

  it("supports RAG retrievers and knowledge_search tool profile", async () => {
    const retriever = createInMemoryKnowledgeRetriever([
      {
        id: "doc-1",
        title: "Corbat Services",
        content: "Corbat builds custom AI agents and software platforms.",
        metadata: { tenantId: "acme" },
      },
      { id: "doc-2", title: "Other", content: "Unrelated content." },
    ]);

    const results = await retriever.search("custom AI agents");
    expect(results[0]?.id).toBe("doc-1");

    const ragRegistry = createRagToolRegistry(retriever, {
      runtimeContext: { surface: "api", tenant: { id: "acme" } },
    });
    expect(ragRegistry.has("knowledge_search")).toBe(true);
    const tenantResults = await ragRegistry.execute("knowledge_search", {
      query: "custom AI agents",
      limit: 1,
    });
    expect(tenantResults.success).toBe(true);
    expect(tenantResults.data).toEqual([expect.objectContaining({ id: "doc-1" })]);

    const ragBlueprint = ragKnowledgeAssistantPreset.createBlueprint({
      brand: "Corbat",
      retriever,
    });
    expect(ragBlueprint.allowedTools).toEqual(["knowledge_search"]);
  });

  it("supports a safe Support/RAG product profile without coding tools", async () => {
    const retriever = createInMemoryKnowledgeRetriever([
      {
        id: "support",
        title: "Support Policy",
        content: "Escalate security-sensitive cases to a human reviewer.",
      },
    ]);
    const registry = createSupportRagToolRegistry({
      retriever,
      supportDraft: async () => ({
        draft: "Draft response",
        citations: ["Support Policy"],
        needsHumanReview: false,
      }),
      humanEscalation: async () => ({
        queued: true,
        escalationId: "esc_1",
        message: "Queued",
      }),
    });

    expect(
      registry
        .getAll()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["create_support_draft", "knowledge_search", "request_human_escalation"]);
    expect(registry.has("bash_exec")).toBe(false);

    const blueprint = supportRagAssistantPreset.createBlueprint({
      brand: "Corbat",
      retriever,
      supportDraft: async () => ({
        draft: "Draft response",
        citations: [],
        needsHumanReview: false,
      }),
      humanEscalation: async () => ({
        queued: true,
        escalationId: "esc_1",
        message: "Queued",
      }),
    });

    expect(blueprint.defaultMode).toBe("draft");
    expect(blueprint.allowedTools).toEqual([
      "knowledge_search",
      "create_support_draft",
      "request_human_escalation",
    ]);
    expect(blueprint.approval.requireHumanForExternalActions).toBe(true);
  });

  it("supports Sales Intake and Internal Ops as constrained product profiles", async () => {
    const salesRegistry = createSalesIntakeToolRegistry({
      leadSummary: async () => ({
        summary: "Qualified lead",
        qualification: "high",
        recommendedNextStep: "Book discovery",
      }),
    });
    expect(salesRegistry.getAll().map((tool) => tool.name)).toEqual(["create_sales_lead_summary"]);
    expect(salesRegistry.has("bash_exec")).toBe(false);

    const salesRuntime = await salesIntakeAssistantPreset.createRuntime({
      brand: "Corbat",
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
      leadSummary: async () => ({
        summary: "Qualified lead",
        qualification: "medium",
        recommendedNextStep: "Collect budget",
      }),
    });
    expect(salesRuntime.snapshot().tools.names).toEqual(["create_sales_lead_summary"]);

    const internalRegistry = createInternalOpsToolRegistry({
      opsDraft: async () => ({
        draft: "Approval draft",
        risk: "medium",
        requiresApproval: true,
      }),
    });
    expect(internalRegistry.getAll().map((tool) => tool.name)).toEqual([
      "create_internal_ops_draft",
    ]);
    expect(internalRegistry.has("write_file")).toBe(false);

    const internalBlueprint = internalOpsAssistantPreset.createBlueprint({
      brand: "Corbat",
      opsDraft: async () => ({
        draft: "Approval draft",
        risk: "high",
        requiresApproval: true,
      }),
    });
    expect(internalBlueprint.surface).toBe("internal");
    expect(internalBlueprint.allowedTools).toEqual(["create_internal_ops_draft"]);
    expect(internalBlueprint.approval.requireHumanForExternalActions).toBe(true);
  });

  it("blocks Support/RAG human escalation unless the embedding app confirms it", async () => {
    const provider = createMockProvider();
    provider.chatWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        id: "support-1",
        content: "I will prepare an escalation.",
        stopReason: "tool_use",
        usage: { inputTokens: 4, outputTokens: 5 },
        model: "mock-model",
        toolCalls: [
          {
            id: "tool-1",
            name: "request_human_escalation",
            input: {
              conversationId: "conv-1",
              summary: "Security case",
              priority: "high",
              reason: "Security-sensitive request",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "support-2",
        content: "Escalation requires explicit confirmation.",
        stopReason: "end_turn",
        usage: { inputTokens: 6, outputTokens: 7 },
        model: "mock-model",
        toolCalls: [],
      });
    const runtime = await supportRagAssistantPreset.createRuntime({
      brand: "Corbat",
      providerType: "openai",
      model: "gpt-5.4",
      provider,
      humanEscalation: async () => ({
        queued: true,
        escalationId: "esc_1",
        message: "Queued",
      }),
    });
    const session = runtime.createSession({ mode: "build" });

    const result = await runtime.runTurn({
      sessionId: session.id,
      content: "Escalate this security case",
    });

    expect(result.content).toContain("confirmation");
    expect(runtime.eventLog.list().map((event) => event.type)).toContain("tool.blocked");
  });

  it("adapts runtime turns to HTTP and webhook style channels", async () => {
    const runtime = await publicWebsiteAssistantPreset.createRuntime({
      brand: "Corbat",
      providerType: "openai",
      model: "gpt-5.4",
      provider: createMockProvider(),
    });

    const http = createHttpAssistantAdapter(runtime);
    const session = http.createSession({ surface: "web" });
    const response = await http.handleMessage({
      sessionId: session.sessionId,
      content: "What do you do?",
    });
    expect(response.content).toBe("assistant reply");

    const webhook = createWebhookAssistantAdapter(runtime, { surface: "whatsapp" });
    const webhookResponse = await webhook.handle({ content: "hola" });
    expect(webhook.surface).toBe("whatsapp");
    expect(webhookResponse.sessionId).toBeTruthy();
  });
});
