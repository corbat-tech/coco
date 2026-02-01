/**
 * Tests for architecture generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ORCHESTRATE_CONFIG } from "./types.js";
import type { ArchitectureDoc, OrchestrateConfig } from "./types.js";
import type { LLMProvider } from "../../providers/types.js";
import { PhaseError } from "../../utils/errors.js";

// Mock LLM provider
function createMockLLM(response: string): LLMProvider {
  return {
    id: "mock-llm",
    name: "Mock LLM",
    async initialize() {},
    async chat() {
      return {
        id: "response-1",
        content: response,
        stopReason: "end_turn" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "mock",
      };
    },
    async chatWithTools() {
      return {
        id: "response-1",
        content: response,
        stopReason: "end_turn" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "mock",
      };
    },
    async *stream() {
      yield { type: "text" as const, text: response };
      yield { type: "done" as const };
    },
    countTokens: (text: string) => Math.ceil(text.length / 4),
    getContextWindow: () => 200000,
    isAvailable: async () => true,
  };
}

// Helper to create mock specification
function createMockSpecification() {
  return {
    version: "1.0.0",
    generatedAt: new Date(),
    overview: {
      name: "Test Project",
      description: "A test project",
      goals: ["Build a REST API"],
      targetUsers: ["developers"],
      successCriteria: ["API is functional"],
    },
    requirements: {
      functional: [
        {
          id: "req-1",
          title: "User Authentication",
          description: "Users should be able to log in",
          priority: "must",
          acceptance: ["Login works"],
        },
      ],
      nonFunctional: [
        { id: "nfr-1", title: "Performance", description: "Fast responses" },
      ],
      constraints: ["Must use TypeScript"],
    },
    technical: {
      stack: ["TypeScript", "Node.js", "Express"],
      architecture: "hexagonal",
      integrations: [],
      deployment: "Docker",
    },
    assumptions: {
      confirmed: [],
      unconfirmed: [],
      risks: [],
    },
    outOfScope: [],
    openQuestions: [],
  };
}

// Helper to create mock architecture doc
function createMockArchitectureDoc(): ArchitectureDoc {
  return {
    version: "1.0.0",
    generatedAt: new Date(),
    overview: {
      pattern: "hexagonal",
      description: "Clean architecture with hexagonal design",
      principles: ["Dependency Inversion", "Single Responsibility"],
      qualityAttributes: [
        { name: "Testability", description: "Easy to test", priority: "high" },
      ],
    },
    components: [
      {
        id: "api",
        name: "API Layer",
        type: "controller",
        description: "REST API endpoints",
        responsibilities: ["Handle HTTP requests"],
        technology: "Express",
        layer: "presentation",
        dependencies: ["domain"],
      },
      {
        id: "domain",
        name: "Domain Layer",
        type: "domain",
        description: "Business logic",
        responsibilities: ["Core business rules"],
        layer: "domain",
        dependencies: [],
      },
    ],
    relationships: [
      { from: "api", to: "domain", type: "uses" },
    ],
    dataModels: [
      {
        name: "User",
        description: "User entity",
        fields: [
          { name: "id", type: "string", required: true },
          { name: "email", type: "string", required: true },
        ],
        relationships: [],
      },
    ],
    integrations: [
      {
        name: "Database",
        type: "database",
        description: "PostgreSQL database",
        endpoint: "localhost:5432",
      },
    ],
    diagrams: [],
  };
}

describe("ArchitectureGenerator", () => {
  let config: OrchestrateConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = { ...DEFAULT_ORCHESTRATE_CONFIG };
  });

  describe("constructor", () => {
    it("should create generator with LLM and config", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");
      const llm = createMockLLM("{}");
      const generator = new ArchitectureGenerator(llm, config);

      expect(generator).toBeDefined();
    });
  });

  describe("generate", () => {
    it("should generate architecture from specification", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const llmResponse = JSON.stringify({
        overview: {
          pattern: "hexagonal",
          description: "Test architecture",
          principles: ["DDD", "SOLID"],
          qualityAttributes: [
            { name: "Maintainability", description: "Easy to maintain", priority: "high" },
          ],
        },
        components: [
          { id: "api", name: "API", type: "controller", description: "REST endpoints" },
        ],
        relationships: [
          { from: "api", to: "domain", type: "uses" },
        ],
        dataModels: [
          { name: "User", description: "User model", fields: [{ name: "id", type: "string", required: true }] },
        ],
        integrations: [
          { name: "DB", type: "database", description: "PostgreSQL" },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ArchitectureGenerator(llm, {
        ...config,
        generateC4Diagrams: false,
        generateSequenceDiagrams: false,
      });

      const result = await generator.generate(createMockSpecification() as any);

      expect(result.overview.pattern).toBe("hexagonal");
      expect(result.components).toHaveLength(1);
      expect(result.relationships).toHaveLength(1);
      expect(result.dataModels).toHaveLength(1);
      expect(result.integrations).toHaveLength(1);
    });

    it("should generate C4 diagrams when configured", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const baseResponse = JSON.stringify({
        overview: { pattern: "hexagonal", description: "Test" },
        components: [],
        relationships: [],
        dataModels: [],
        integrations: [],
      });

      const diagramResponse = JSON.stringify({
        diagrams: [
          { id: "ctx", type: "c4_context", title: "Context", description: "Context diagram", mermaid: "C4Context\n" },
        ],
      });

      let callCount = 0;
      const llm = {
        ...createMockLLM(baseResponse),
        async chat() {
          callCount++;
          return {
            id: `response-${callCount}`,
            content: callCount === 1 ? baseResponse : diagramResponse,
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 50 },
            model: "mock",
          };
        },
      };

      const generator = new ArchitectureGenerator(llm as any, {
        ...config,
        generateC4Diagrams: true,
        generateSequenceDiagrams: false,
      });

      const result = await generator.generate(createMockSpecification() as any);

      expect(result.diagrams.length).toBeGreaterThan(0);
    });

    it("should generate sequence diagrams when configured", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const baseResponse = JSON.stringify({
        overview: { pattern: "hexagonal", description: "Test" },
        components: [],
        relationships: [],
        dataModels: [],
        integrations: [],
      });

      const seqResponse = JSON.stringify({
        diagrams: [
          { id: "seq1", type: "sequence", title: "Auth Flow", description: "Authentication sequence", mermaid: "sequenceDiagram\n" },
        ],
      });

      let callCount = 0;
      const llm = {
        ...createMockLLM(baseResponse),
        async chat() {
          callCount++;
          return {
            id: `response-${callCount}`,
            content: callCount === 1 ? baseResponse : seqResponse,
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 50 },
            model: "mock",
          };
        },
      };

      const generator = new ArchitectureGenerator(llm as any, {
        ...config,
        generateC4Diagrams: false,
        generateSequenceDiagrams: true,
      });

      const result = await generator.generate(createMockSpecification() as any);

      expect(result.diagrams.length).toBeGreaterThan(0);
    });

    it("should throw PhaseError when no JSON in response", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const llm = createMockLLM("No JSON here, just text");
      const generator = new ArchitectureGenerator(llm, {
        ...config,
        generateC4Diagrams: false,
        generateSequenceDiagrams: false,
      });

      await expect(generator.generate(createMockSpecification() as any)).rejects.toThrow(PhaseError);
    });

    it("should provide default values for missing fields", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const llmResponse = JSON.stringify({
        overview: {},
        components: [{}],
        relationships: [{}],
        dataModels: [{ fields: [{}] }],
        integrations: [{}],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ArchitectureGenerator(llm, {
        ...config,
        generateC4Diagrams: false,
        generateSequenceDiagrams: false,
      });

      const result = await generator.generate(createMockSpecification() as any);

      expect(result.overview.pattern).toBe("layered");
      expect(result.overview.description).toBe("System architecture");
      expect(result.components[0].type).toBe("service");
      expect(result.relationships[0].type).toBe("uses");
      expect(result.dataModels[0].name).toBe("Model");
      expect(result.integrations[0].type).toBe("rest_api");
    });

    it("should handle empty arrays in response", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const llmResponse = JSON.stringify({
        overview: { pattern: "hexagonal", description: "Test" },
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ArchitectureGenerator(llm, {
        ...config,
        generateC4Diagrams: false,
        generateSequenceDiagrams: false,
      });

      const result = await generator.generate(createMockSpecification() as any);

      expect(result.components).toEqual([]);
      expect(result.relationships).toEqual([]);
      expect(result.dataModels).toEqual([]);
      expect(result.integrations).toEqual([]);
    });

    it("should use fallback C4 diagrams on LLM failure", async () => {
      const { ArchitectureGenerator } = await import("./architecture.js");

      const baseResponse = JSON.stringify({
        overview: { pattern: "hexagonal", description: "Test description here" },
        components: [
          { id: "api", name: "API", type: "controller", layer: "presentation" },
        ],
        relationships: [],
        dataModels: [],
        integrations: [
          { name: "External Service", type: "rest_api", description: "External" },
        ],
      });

      let callCount = 0;
      const llm = {
        ...createMockLLM(baseResponse),
        async chat() {
          callCount++;
          if (callCount === 1) {
            return {
              id: "response-1",
              content: baseResponse,
              stopReason: "end_turn" as const,
              usage: { inputTokens: 100, outputTokens: 50 },
              model: "mock",
            };
          }
          // Return invalid response for diagrams
          return {
            id: "response-2",
            content: "Invalid response",
            stopReason: "end_turn" as const,
            usage: { inputTokens: 100, outputTokens: 50 },
            model: "mock",
          };
        },
      };

      const generator = new ArchitectureGenerator(llm as any, {
        ...config,
        generateC4Diagrams: true,
        generateSequenceDiagrams: false,
      });

      const result = await generator.generate(createMockSpecification() as any);

      // Should have fallback diagrams
      expect(result.diagrams.length).toBeGreaterThan(0);
      expect(result.diagrams.some(d => d.type === "c4_context")).toBe(true);
      expect(result.diagrams.some(d => d.type === "c4_container")).toBe(true);
    });
  });
});

describe("generateArchitectureMarkdown", () => {
  it("should generate markdown with header", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("# Architecture Document");
    expect(markdown).toContain("Version: 1.0.0");
  });

  it("should include overview section", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("## Overview");
    expect(markdown).toContain("**Pattern:** hexagonal");
    expect(markdown).toContain("Clean architecture with hexagonal design");
  });

  it("should include design principles", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("### Design Principles");
    expect(markdown).toContain("- Dependency Inversion");
    expect(markdown).toContain("- Single Responsibility");
  });

  it("should include quality attributes table", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("### Quality Attributes");
    expect(markdown).toContain("| Attribute | Priority | Description |");
    expect(markdown).toContain("| Testability | high | Easy to test |");
  });

  it("should include components section", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("## Components");
    expect(markdown).toContain("### API Layer");
    expect(markdown).toContain("**Type:** controller");
    expect(markdown).toContain("**Layer:** presentation");
    expect(markdown).toContain("**Technology:** Express");
    expect(markdown).toContain("**Responsibilities:**");
    expect(markdown).toContain("- Handle HTTP requests");
  });

  it("should include data models section", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("## Data Models");
    expect(markdown).toContain("### User");
    expect(markdown).toContain("| Field | Type | Required |");
    expect(markdown).toContain("| id | string | Yes |");
    expect(markdown).toContain("| email | string | Yes |");
  });

  it("should include integrations section", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("## Integrations");
    expect(markdown).toContain("### Database");
    expect(markdown).toContain("**Type:** database");
    expect(markdown).toContain("PostgreSQL database");
  });

  it("should include diagrams section when present", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();
    doc.diagrams = [
      {
        id: "ctx",
        type: "c4_context",
        title: "System Context",
        description: "High-level view",
        mermaid: "C4Context\n  title System",
      },
    ];

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("## Diagrams");
    expect(markdown).toContain("### System Context");
    expect(markdown).toContain("High-level view");
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("C4Context");
  });

  it("should include Corbat-Coco attribution", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc = createMockArchitectureDoc();

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).toContain("*Generated by Corbat-Coco*");
  });

  it("should omit empty sections", async () => {
    const { generateArchitectureMarkdown } = await import("./architecture.js");
    const doc: ArchitectureDoc = {
      version: "1.0.0",
      generatedAt: new Date(),
      overview: {
        pattern: "layered",
        description: "Simple architecture",
        principles: [],
        qualityAttributes: [],
      },
      components: [],
      relationships: [],
      dataModels: [],
      integrations: [],
      diagrams: [],
    };

    const markdown = generateArchitectureMarkdown(doc);

    expect(markdown).not.toContain("### Design Principles");
    expect(markdown).not.toContain("### Quality Attributes");
    expect(markdown).not.toContain("## Data Models");
    expect(markdown).not.toContain("## Integrations");
    expect(markdown).not.toContain("## Diagrams");
  });
});

describe("createArchitectureGenerator", () => {
  it("should create an ArchitectureGenerator instance", async () => {
    const { createArchitectureGenerator, ArchitectureGenerator } = await import("./architecture.js");

    const llm = createMockLLM("{}");
    const generator = createArchitectureGenerator(llm, DEFAULT_ORCHESTRATE_CONFIG);

    expect(generator).toBeInstanceOf(ArchitectureGenerator);
  });
});
