/**
 * Tests for main exports
 */

import { describe, it, expect } from "vitest";
import * as CocoExports from "./index.js";
import packageJson from "../package.json" with { type: "json" };

describe("Main module exports", () => {
  describe("version", () => {
    it("should export VERSION", () => {
      expect(CocoExports.VERSION).toBeDefined();
      expect(typeof CocoExports.VERSION).toBe("string");
    });
  });

  describe("orchestrator", () => {
    it("should export createOrchestrator", () => {
      expect(CocoExports.createOrchestrator).toBeDefined();
      expect(typeof CocoExports.createOrchestrator).toBe("function");
    });
  });

  describe("configuration", () => {
    it("should export loadConfig", () => {
      expect(CocoExports.loadConfig).toBeDefined();
      expect(typeof CocoExports.loadConfig).toBe("function");
    });

    it("should export saveConfig", () => {
      expect(CocoExports.saveConfig).toBeDefined();
      expect(typeof CocoExports.saveConfig).toBe("function");
    });

    it("should export createDefaultConfig", () => {
      expect(CocoExports.createDefaultConfig).toBeDefined();
      expect(typeof CocoExports.createDefaultConfig).toBe("function");
    });

    it("should export configExists", () => {
      expect(CocoExports.configExists).toBeDefined();
      expect(typeof CocoExports.configExists).toBe("function");
    });
  });

  describe("converge phase", () => {
    it("should export DiscoveryEngine", () => {
      expect(CocoExports.DiscoveryEngine).toBeDefined();
    });

    it("should export createDiscoveryEngine", () => {
      expect(CocoExports.createDiscoveryEngine).toBeDefined();
      expect(typeof CocoExports.createDiscoveryEngine).toBe("function");
    });

    it("should export SpecificationGenerator", () => {
      expect(CocoExports.SpecificationGenerator).toBeDefined();
    });

    it("should export createSpecificationGenerator", () => {
      expect(CocoExports.createSpecificationGenerator).toBeDefined();
      expect(typeof CocoExports.createSpecificationGenerator).toBe("function");
    });

    it("should export SessionManager", () => {
      expect(CocoExports.SessionManager).toBeDefined();
    });

    it("should export createSessionManager", () => {
      expect(CocoExports.createSessionManager).toBeDefined();
      expect(typeof CocoExports.createSessionManager).toBe("function");
    });

    it("should export ConvergeExecutor", () => {
      expect(CocoExports.ConvergeExecutor).toBeDefined();
    });

    it("should export createConvergeExecutor", () => {
      expect(CocoExports.createConvergeExecutor).toBeDefined();
      expect(typeof CocoExports.createConvergeExecutor).toBe("function");
    });
  });

  describe("orchestrate phase", () => {
    it("should export ArchitectureGenerator", () => {
      expect(CocoExports.ArchitectureGenerator).toBeDefined();
    });

    it("should export createArchitectureGenerator", () => {
      expect(CocoExports.createArchitectureGenerator).toBeDefined();
      expect(typeof CocoExports.createArchitectureGenerator).toBe("function");
    });

    it("should export ADRGenerator", () => {
      expect(CocoExports.ADRGenerator).toBeDefined();
    });

    it("should export createADRGenerator", () => {
      expect(CocoExports.createADRGenerator).toBeDefined();
      expect(typeof CocoExports.createADRGenerator).toBe("function");
    });

    it("should export BacklogGenerator", () => {
      expect(CocoExports.BacklogGenerator).toBeDefined();
    });

    it("should export createBacklogGenerator", () => {
      expect(CocoExports.createBacklogGenerator).toBeDefined();
      expect(typeof CocoExports.createBacklogGenerator).toBe("function");
    });

    it("should export OrchestrateExecutor", () => {
      expect(CocoExports.OrchestrateExecutor).toBeDefined();
    });

    it("should export createOrchestrateExecutor", () => {
      expect(CocoExports.createOrchestrateExecutor).toBeDefined();
      expect(typeof CocoExports.createOrchestrateExecutor).toBe("function");
    });
  });

  describe("complete phase", () => {
    it("should export CodeGenerator", () => {
      expect(CocoExports.CodeGenerator).toBeDefined();
    });

    it("should export createCodeGenerator", () => {
      expect(CocoExports.createCodeGenerator).toBeDefined();
      expect(typeof CocoExports.createCodeGenerator).toBe("function");
    });

    it("should export CodeReviewer", () => {
      expect(CocoExports.CodeReviewer).toBeDefined();
    });

    it("should export createCodeReviewer", () => {
      expect(CocoExports.createCodeReviewer).toBeDefined();
      expect(typeof CocoExports.createCodeReviewer).toBe("function");
    });

    it("should export TaskIterator", () => {
      expect(CocoExports.TaskIterator).toBeDefined();
    });

    it("should export createTaskIterator", () => {
      expect(CocoExports.createTaskIterator).toBeDefined();
      expect(typeof CocoExports.createTaskIterator).toBe("function");
    });

    it("should export CompleteExecutor", () => {
      expect(CocoExports.CompleteExecutor).toBeDefined();
    });

    it("should export createCompleteExecutor", () => {
      expect(CocoExports.createCompleteExecutor).toBeDefined();
      expect(typeof CocoExports.createCompleteExecutor).toBe("function");
    });
  });

  describe("output phase", () => {
    it("should export CICDGenerator", () => {
      expect(CocoExports.CICDGenerator).toBeDefined();
    });

    it("should export createCICDGenerator", () => {
      expect(CocoExports.createCICDGenerator).toBeDefined();
      expect(typeof CocoExports.createCICDGenerator).toBe("function");
    });

    it("should export DockerGenerator", () => {
      expect(CocoExports.DockerGenerator).toBeDefined();
    });

    it("should export createDockerGenerator", () => {
      expect(CocoExports.createDockerGenerator).toBeDefined();
      expect(typeof CocoExports.createDockerGenerator).toBe("function");
    });

    it("should export DocsGenerator", () => {
      expect(CocoExports.DocsGenerator).toBeDefined();
    });

    it("should export createDocsGenerator", () => {
      expect(CocoExports.createDocsGenerator).toBeDefined();
      expect(typeof CocoExports.createDocsGenerator).toBe("function");
    });

    it("should export OutputExecutor", () => {
      expect(CocoExports.OutputExecutor).toBeDefined();
    });

    it("should export createOutputExecutor", () => {
      expect(CocoExports.createOutputExecutor).toBeDefined();
      expect(typeof CocoExports.createOutputExecutor).toBe("function");
    });
  });

  describe("providers", () => {
    it("should export AnthropicProvider", () => {
      expect(CocoExports.AnthropicProvider).toBeDefined();
    });

    it("should export createAnthropicProvider", () => {
      expect(CocoExports.createAnthropicProvider).toBeDefined();
      expect(typeof CocoExports.createAnthropicProvider).toBe("function");
    });

    it("should export createProvider", () => {
      expect(CocoExports.createProvider).toBeDefined();
      expect(typeof CocoExports.createProvider).toBe("function");
    });
  });

  describe("runtime", () => {
    it("should export AgentRuntime", () => {
      expect(CocoExports.AgentRuntime).toBeDefined();
    });

    it("should export createAgentRuntime", () => {
      expect(CocoExports.createAgentRuntime).toBeDefined();
      expect(typeof CocoExports.createAgentRuntime).toBe("function");
    });

    it("should export reusable runtime registries and policies", () => {
      expect(CocoExports.ProviderRegistry).toBeDefined();
      expect(CocoExports.InMemoryEventLog).toBeDefined();
      expect(CocoExports.DefaultPermissionPolicy).toBeDefined();
      expect(CocoExports.WorkflowCatalog).toBeDefined();
      expect(CocoExports.WorkflowRegistry).toBeDefined();
      expect(CocoExports.DEFAULT_WORKFLOWS).toBeDefined();
      expect(typeof CocoExports.createProviderRegistry).toBe("function");
      expect(typeof CocoExports.createEventLog).toBe("function");
      expect(typeof CocoExports.createPermissionPolicy).toBe("function");
      expect(typeof CocoExports.createMcpToolPolicy).toBe("function");
      expect(typeof CocoExports.createWorkflowCatalog).toBe("function");
      expect(typeof CocoExports.createWorkflowRegistry).toBe("function");
      expect(typeof CocoExports.createAgentGraphEngine).toBe("function");
      expect(typeof CocoExports.createAgentDefinitionRegistry).toBe("function");
      expect(typeof CocoExports.createRuntimeAgentNodeExecutor).toBe("function");
      expect(typeof CocoExports.createAgentRunner).toBe("function");
      expect(typeof CocoExports.createAgentTraceContext).toBe("function");
      expect(typeof CocoExports.evaluateAgentToolPolicy).toBe("function");
      expect(typeof CocoExports.mapLegacyAgentRole).toBe("function");
      expect(CocoExports.AgentGraphEngine).toBeDefined();
      expect(CocoExports.AgentDefinitionRegistry).toBeDefined();
      expect(CocoExports.RuntimeAgentNodeExecutor).toBeDefined();
      expect(CocoExports.AgentRunner).toBeDefined();
      expect(CocoExports.InMemorySharedWorkspaceStore).toBeDefined();
    });

    it("should export reusable agent platform APIs", () => {
      expect(typeof CocoExports.createAgentFromBlueprint).toBe("function");
      expect(typeof CocoExports.createBaseBlueprint).toBe("function");
      expect(typeof CocoExports.runGuardrails).toBe("function");
      expect(typeof CocoExports.runGuardrailPipeline).toBe("function");
      expect(typeof CocoExports.redactSecrets).toBe("function");
      expect(typeof CocoExports.createAsyncPostgresRuntimeSessionStore).toBe("function");
      expect(typeof CocoExports.createAsyncPostgresEventLog).toBe("function");
      expect(typeof CocoExports.createPostgresRuntimeAuditStore).toBe("function");
      expect(typeof CocoExports.createTenantScopedRuntimeSessionStore).toBe("function");
      expect(typeof CocoExports.createDocumentAccessPolicy).toBe("function");
      expect(typeof CocoExports.createRagIngestionJob).toBe("function");
      expect(typeof CocoExports.verifyCitations).toBe("function");
      expect(typeof CocoExports.evaluateGroundedness).toBe("function");
      expect(typeof CocoExports.collectRuntimeMetrics).toBe("function");
      expect(typeof CocoExports.exportRuntimeEventsAsSpans).toBe("function");
      expect(CocoExports.InMemoryTraceExporter).toBeDefined();
      expect(typeof CocoExports.createInMemoryKnowledgeRetriever).toBe("function");
      expect(CocoExports.publicWebsiteAssistantPreset).toBeDefined();
      expect(CocoExports.ragKnowledgeAssistantPreset).toBeDefined();
      expect(CocoExports.supportRagAssistantPreset).toBeDefined();
      expect(CocoExports.salesIntakeAssistantPreset).toBeDefined();
      expect(CocoExports.customerSupportAssistantPreset).toBeDefined();
      expect(CocoExports.appointmentBookingAssistantPreset).toBeDefined();
      expect(CocoExports.internalOpsAssistantPreset).toBeDefined();
      expect(CocoExports.codingAgentPreset).toBeDefined();
      expect(typeof CocoExports.createHttpAssistantAdapter).toBe("function");
      expect(typeof CocoExports.createStreamingHttpAssistantAdapter).toBe("function");
      expect(typeof CocoExports.createWebhookAssistantAdapter).toBe("function");
      expect(typeof CocoExports.createWhatsAppCloudAdapter).toBe("function");
      expect(typeof CocoExports.createToolCallingRuntimeTurnRunner).toBe("function");
      expect(typeof CocoExports.createSupportRagToolRegistry).toBe("function");
    });
  });

  describe("package subpath contracts", () => {
    it("should expose stable v0 runtime, tools, presets, and adapters subpaths", () => {
      expect(packageJson.exports).toMatchObject({
        ".": "./dist/index.js",
        "./runtime": "./dist/runtime/index.js",
        "./tools": "./dist/tools/index.js",
        "./presets": "./dist/presets/index.js",
        "./adapters": "./dist/adapters/index.js",
      });
    });
  });

  describe("tools", () => {
    it("should export ToolRegistry", () => {
      expect(CocoExports.ToolRegistry).toBeDefined();
    });

    it("should export createToolRegistry", () => {
      expect(CocoExports.createToolRegistry).toBeDefined();
      expect(typeof CocoExports.createToolRegistry).toBe("function");
    });

    it("should export registerAllTools", () => {
      expect(CocoExports.registerAllTools).toBeDefined();
      expect(typeof CocoExports.registerAllTools).toBe("function");
    });

    it("should export createFullToolRegistry", () => {
      expect(CocoExports.createFullToolRegistry).toBeDefined();
      expect(typeof CocoExports.createFullToolRegistry).toBe("function");
    });

    it("should export safe tool profiles", () => {
      expect(typeof CocoExports.createNoToolRegistry).toBe("function");
      expect(typeof CocoExports.createPublicWebToolRegistry).toBe("function");
      expect(typeof CocoExports.createRagToolRegistry).toBe("function");
      expect(typeof CocoExports.createCustomerSupportToolRegistry).toBe("function");
      expect(typeof CocoExports.createCodingToolRegistry).toBe("function");
    });
  });

  describe("utilities", () => {
    it("should export CocoError", () => {
      expect(CocoExports.CocoError).toBeDefined();
    });

    it("should export ConfigError", () => {
      expect(CocoExports.ConfigError).toBeDefined();
    });

    it("should export PhaseError", () => {
      expect(CocoExports.PhaseError).toBeDefined();
    });

    it("should export TaskError", () => {
      expect(CocoExports.TaskError).toBeDefined();
    });

    it("should export createLogger", () => {
      expect(CocoExports.createLogger).toBeDefined();
      expect(typeof CocoExports.createLogger).toBe("function");
    });
  });
});
