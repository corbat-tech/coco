/**
 * Tests for ADR Generator
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ADRGenerator,
  generateADRMarkdown,
  generateADRIndexMarkdown,
  getADRFilename,
  createADRGenerator,
  ADR_TEMPLATES,
} from "./adr.js";
import type { ADR, ArchitectureDoc, OrchestrateConfig } from "./types.js";
import { DEFAULT_ORCHESTRATE_CONFIG } from "./types.js";
import type { Specification } from "../converge/types.js";
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

// Helper to create mock architecture
function createMockArchitecture(): ArchitectureDoc {
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
        dependencies: ["domain"],
      },
      {
        id: "domain",
        name: "Domain Layer",
        type: "domain",
        description: "Business logic",
        responsibilities: ["Core business rules"],
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
        fields: [{ name: "id", type: "string", required: true }],
        relationships: [],
      },
    ],
    integrations: [],
    diagrams: [],
  };
}

// Helper to create mock specification
function createMockSpecification(): Specification {
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
      constraints: [],
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

// Helper to create mock ADR
function createMockADR(overrides: Partial<ADR> = {}): ADR {
  return {
    id: "adr-123",
    number: 1,
    title: "Use TypeScript",
    date: new Date("2024-01-15"),
    status: "accepted",
    context: "We need to choose a programming language",
    decision: "We will use TypeScript for type safety",
    consequences: {
      positive: ["Better IDE support", "Type checking"],
      negative: ["Learning curve"],
      neutral: ["Build step required"],
    },
    alternatives: [
      {
        option: "JavaScript",
        pros: ["No build step"],
        cons: ["No type safety"],
        reason: "TypeScript provides better maintainability",
      },
    ],
    references: ["https://www.typescriptlang.org/"],
    ...overrides,
  };
}

describe("ADRGenerator", () => {
  let config: OrchestrateConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = { ...DEFAULT_ORCHESTRATE_CONFIG };
  });

  describe("constructor", () => {
    it("should create generator with LLM and config", () => {
      const llm = createMockLLM("{}");
      const generator = new ADRGenerator(llm, config);

      expect(generator).toBeDefined();
    });
  });

  describe("generate", () => {
    it("should generate ADRs from architecture and specification", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          {
            number: 1,
            title: "Use Hexagonal Architecture",
            status: "accepted",
            context: "Need to define the system architecture",
            decision: "Use hexagonal architecture for clean separation",
            consequences: {
              positive: ["Better testability"],
              negative: ["More complexity"],
            },
          },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs).toHaveLength(1);
      expect(adrs[0].title).toBe("Use Hexagonal Architecture");
      expect(adrs[0].status).toBe("accepted");
    });

    it("should handle multiple ADRs", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          { number: 1, title: "ADR 1", context: "Context 1", decision: "Decision 1" },
          { number: 2, title: "ADR 2", context: "Context 2", decision: "Decision 2" },
          { number: 3, title: "ADR 3", context: "Context 3", decision: "Decision 3" },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs).toHaveLength(3);
    });

    it("should provide default values for missing ADR fields", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          {
            title: "Minimal ADR",
          },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs).toHaveLength(1);
      expect(adrs[0].number).toBe(1);
      expect(adrs[0].status).toBe("accepted");
      expect(adrs[0].context).toBe("");
      expect(adrs[0].decision).toBe("");
      expect(adrs[0].consequences.positive).toEqual([]);
      expect(adrs[0].consequences.negative).toEqual([]);
    });

    it("should handle empty ADR array in response", async () => {
      const llmResponse = JSON.stringify({ adrs: [] });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs).toEqual([]);
    });

    it("should throw PhaseError when response has no JSON", async () => {
      const llm = createMockLLM("No JSON here, just text");
      const generator = new ADRGenerator(llm, config);

      await expect(
        generator.generate(createMockArchitecture(), createMockSpecification())
      ).rejects.toThrow(PhaseError);
    });

    it("should throw PhaseError on malformed JSON", async () => {
      const llm = createMockLLM("{ invalid json }");
      const generator = new ADRGenerator(llm, config);

      await expect(
        generator.generate(createMockArchitecture(), createMockSpecification())
      ).rejects.toThrow(PhaseError);
    });

    it("should parse alternatives correctly", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          {
            number: 1,
            title: "Database Choice",
            context: "Need a database",
            decision: "Use PostgreSQL",
            alternatives: [
              {
                option: "MySQL",
                pros: ["Popular"],
                cons: ["Less features"],
                reason: "PostgreSQL has better JSON support",
              },
              {
                option: "MongoDB",
                pros: ["Flexible schema"],
                cons: ["No ACID"],
                reason: "Need relational data",
              },
            ],
          },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs[0].alternatives).toHaveLength(2);
      expect(adrs[0].alternatives?.[0].option).toBe("MySQL");
      expect(adrs[0].alternatives?.[1].option).toBe("MongoDB");
    });

    it("should parse references correctly", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          {
            number: 1,
            title: "Use TypeScript",
            references: [
              "https://www.typescriptlang.org/",
              "https://docs.example.com/",
            ],
          },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs[0].references).toHaveLength(2);
      expect(adrs[0].references?.[0]).toContain("typescriptlang.org");
    });

    it("should generate unique IDs for each ADR", async () => {
      const llmResponse = JSON.stringify({
        adrs: [
          { number: 1, title: "ADR 1" },
          { number: 2, title: "ADR 2" },
        ],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs[0].id).not.toBe(adrs[1].id);
    });

    it("should set date to current date", async () => {
      const llmResponse = JSON.stringify({
        adrs: [{ number: 1, title: "ADR" }],
      });

      const llm = createMockLLM(llmResponse);
      const generator = new ADRGenerator(llm, config);

      const adrs = await generator.generate(
        createMockArchitecture(),
        createMockSpecification()
      );

      expect(adrs[0].date).toBeInstanceOf(Date);
      // Check it's recent (within last minute)
      const timeDiff = Date.now() - adrs[0].date.getTime();
      expect(timeDiff).toBeLessThan(60000);
    });
  });
});

describe("generateADRMarkdown", () => {
  it("should generate markdown with title and number", () => {
    const adr = createMockADR({ number: 5, title: "Use Docker" });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("# ADR 005: Use Docker");
  });

  it("should pad number with leading zeros", () => {
    const adr = createMockADR({ number: 1 });
    expect(generateADRMarkdown(adr)).toContain("ADR 001:");

    const adr2 = createMockADR({ number: 10 });
    expect(generateADRMarkdown(adr2)).toContain("ADR 010:");

    const adr3 = createMockADR({ number: 100 });
    expect(generateADRMarkdown(adr3)).toContain("ADR 100:");
  });

  it("should include date and status", () => {
    const adr = createMockADR({
      date: new Date("2024-06-15"),
      status: "proposed",
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("**Date:** 2024-06-15");
    expect(markdown).toContain("**Status:** proposed");
  });

  it("should include context section", () => {
    const adr = createMockADR({ context: "We need to make an important decision" });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("## Context");
    expect(markdown).toContain("We need to make an important decision");
  });

  it("should include decision section", () => {
    const adr = createMockADR({ decision: "We will implement feature X" });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("We will implement feature X");
  });

  it("should include positive consequences with checkmark", () => {
    const adr = createMockADR({
      consequences: {
        positive: ["Better performance", "Easier maintenance"],
        negative: [],
      },
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("## Consequences");
    expect(markdown).toContain("### Positive");
    expect(markdown).toContain("- ✅ Better performance");
    expect(markdown).toContain("- ✅ Easier maintenance");
  });

  it("should include negative consequences with warning", () => {
    const adr = createMockADR({
      consequences: {
        positive: [],
        negative: ["More complexity", "Higher cost"],
      },
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("### Negative");
    expect(markdown).toContain("- ⚠️ More complexity");
    expect(markdown).toContain("- ⚠️ Higher cost");
  });

  it("should include neutral consequences when present", () => {
    const adr = createMockADR({
      consequences: {
        positive: [],
        negative: [],
        neutral: ["Requires migration", "New tooling needed"],
      },
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("### Neutral");
    expect(markdown).toContain("- Requires migration");
    expect(markdown).toContain("- New tooling needed");
  });

  it("should omit neutral section when empty", () => {
    const adr = createMockADR({
      consequences: {
        positive: ["Good"],
        negative: ["Bad"],
        neutral: [],
      },
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).not.toContain("### Neutral");
  });

  it("should include alternatives section", () => {
    const adr = createMockADR({
      alternatives: [
        {
          option: "Alternative A",
          pros: ["Pro 1", "Pro 2"],
          cons: ["Con 1"],
          reason: "Not chosen because of Con 1",
        },
      ],
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("## Alternatives Considered");
    expect(markdown).toContain("### Alternative A");
    expect(markdown).toContain("**Pros:**");
    expect(markdown).toContain("- Pro 1");
    expect(markdown).toContain("- Pro 2");
    expect(markdown).toContain("**Cons:**");
    expect(markdown).toContain("- Con 1");
    expect(markdown).toContain("**Why not chosen:** Not chosen because of Con 1");
  });

  it("should omit alternatives section when empty", () => {
    const adr = createMockADR({ alternatives: [] });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).not.toContain("## Alternatives Considered");
  });

  it("should include references section", () => {
    const adr = createMockADR({
      references: [
        "https://example.com/doc1",
        "https://example.com/doc2",
      ],
    });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).toContain("## References");
    expect(markdown).toContain("- https://example.com/doc1");
    expect(markdown).toContain("- https://example.com/doc2");
  });

  it("should omit references section when empty", () => {
    const adr = createMockADR({ references: [] });

    const markdown = generateADRMarkdown(adr);

    expect(markdown).not.toContain("## References");
  });
});

describe("generateADRIndexMarkdown", () => {
  it("should generate index title", () => {
    const adrs: ADR[] = [];

    const index = generateADRIndexMarkdown(adrs);

    expect(index).toContain("# Architecture Decision Records");
  });

  it("should include description of ADRs", () => {
    const adrs: ADR[] = [];

    const index = generateADRIndexMarkdown(adrs);

    expect(index).toContain("Architecture Decision Records (ADRs)");
    expect(index).toContain("## About ADRs");
  });

  it("should generate table with headers", () => {
    const adrs: ADR[] = [];

    const index = generateADRIndexMarkdown(adrs);

    expect(index).toContain("## Index");
    expect(index).toContain("| # | Title | Status | Date |");
    expect(index).toContain("|---|-------|--------|------|");
  });

  it("should list all ADRs in table", () => {
    const adrs: ADR[] = [
      createMockADR({ number: 1, title: "First Decision", status: "accepted", date: new Date("2024-01-15") }),
      createMockADR({ number: 2, title: "Second Decision", status: "proposed", date: new Date("2024-02-20") }),
    ];

    const index = generateADRIndexMarkdown(adrs);

    expect(index).toContain("| 1 |");
    expect(index).toContain("First Decision");
    expect(index).toContain("| accepted |");
    expect(index).toContain("2024-01-15");

    expect(index).toContain("| 2 |");
    expect(index).toContain("Second Decision");
    expect(index).toContain("| proposed |");
    expect(index).toContain("2024-02-20");
  });

  it("should generate correct links to ADR files", () => {
    const adrs: ADR[] = [
      createMockADR({ number: 1, title: "Use TypeScript" }),
    ];

    const index = generateADRIndexMarkdown(adrs);

    expect(index).toContain("[Use TypeScript](./001-use-typescript.md)");
  });

  it("should include ADR information", () => {
    const index = generateADRIndexMarkdown([]);

    expect(index).toContain("context and problem");
    expect(index).toContain("decision made");
    expect(index).toContain("consequences");
    expect(index).toContain("Alternatives considered");
  });

  it("should include reference to ADR documentation", () => {
    const index = generateADRIndexMarkdown([]);

    expect(index).toContain("adr.github.io");
  });
});

describe("getADRFilename", () => {
  it("should generate filename with padded number", () => {
    const adr = createMockADR({ number: 1, title: "Use TypeScript" });

    const filename = getADRFilename(adr);

    expect(filename).toBe("001-use-typescript.md");
  });

  it("should slugify title correctly", () => {
    const adr = createMockADR({ number: 5, title: "Use Docker for Deployment" });

    const filename = getADRFilename(adr);

    expect(filename).toBe("005-use-docker-for-deployment.md");
  });

  it("should handle special characters in title", () => {
    const adr = createMockADR({ number: 3, title: "Use C# & .NET Framework!" });

    const filename = getADRFilename(adr);

    expect(filename).toBe("003-use-c-net-framework.md");
  });

  it("should handle numbers with different lengths", () => {
    expect(getADRFilename(createMockADR({ number: 1, title: "Test" }))).toContain("001-");
    expect(getADRFilename(createMockADR({ number: 10, title: "Test" }))).toContain("010-");
    expect(getADRFilename(createMockADR({ number: 100, title: "Test" }))).toContain("100-");
  });

  it("should lowercase the title", () => {
    const adr = createMockADR({ number: 1, title: "UPPERCASE Title" });

    const filename = getADRFilename(adr);

    expect(filename).toBe("001-uppercase-title.md");
  });

  it("should replace spaces with dashes", () => {
    const adr = createMockADR({ number: 1, title: "Multiple   Spaces   Here" });

    const filename = getADRFilename(adr);

    expect(filename).toBe("001-multiple-spaces-here.md");
  });
});

describe("createADRGenerator", () => {
  it("should create an ADRGenerator instance", () => {
    const llm = createMockLLM("{}");
    const config = DEFAULT_ORCHESTRATE_CONFIG;

    const generator = createADRGenerator(llm, config);

    expect(generator).toBeInstanceOf(ADRGenerator);
  });
});

describe("ADR_TEMPLATES", () => {
  it("should have architecture template", () => {
    expect(ADR_TEMPLATES.architecture).toBeDefined();
    expect(ADR_TEMPLATES.architecture.title).toBe("Core Architecture Pattern");
    expect(ADR_TEMPLATES.architecture.contextTemplate).toContain("requirements");
    expect(ADR_TEMPLATES.architecture.decisionTemplate).toContain("pattern");
  });

  it("should have language template", () => {
    expect(ADR_TEMPLATES.language).toBeDefined();
    expect(ADR_TEMPLATES.language.title).toBe("Programming Language");
    expect(ADR_TEMPLATES.language.contextTemplate).toContain("component");
    expect(ADR_TEMPLATES.language.decisionTemplate).toContain("language");
  });

  it("should have database template", () => {
    expect(ADR_TEMPLATES.database).toBeDefined();
    expect(ADR_TEMPLATES.database.title).toBe("Database Selection");
    expect(ADR_TEMPLATES.database.contextTemplate).toContain("dataType");
    expect(ADR_TEMPLATES.database.decisionTemplate).toContain("database");
  });

  it("should have testing template", () => {
    expect(ADR_TEMPLATES.testing).toBeDefined();
    expect(ADR_TEMPLATES.testing.title).toBe("Testing Strategy");
    expect(ADR_TEMPLATES.testing.contextTemplate).toContain("testing strategy");
    expect(ADR_TEMPLATES.testing.decisionTemplate).toContain("testFramework");
  });

  it("should have deployment template", () => {
    expect(ADR_TEMPLATES.deployment).toBeDefined();
    expect(ADR_TEMPLATES.deployment.title).toBe("Deployment Strategy");
    expect(ADR_TEMPLATES.deployment.contextTemplate).toContain("deployed");
    expect(ADR_TEMPLATES.deployment.decisionTemplate).toContain("strategy");
  });
});
