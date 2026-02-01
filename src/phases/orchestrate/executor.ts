/**
 * ORCHESTRATE Phase Executor
 *
 * Orchestrates the architecture design, ADR creation, and backlog generation
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  PhaseExecutor,
  PhaseContext,
  PhaseResult,
  PhaseCheckpoint,
  PhaseArtifact,
} from "../types.js";
import type {
  OrchestrateConfig,
  OrchestrateOutput,
  ArchitectureDoc,
  ADR,
  BacklogResult,
} from "./types.js";
import { DEFAULT_ORCHESTRATE_CONFIG } from "./types.js";
import type { Specification } from "../converge/types.js";
import type { Sprint } from "../../types/task.js";
import {
  ArchitectureGenerator,
  generateArchitectureMarkdown,
} from "./architecture.js";
import { ADRGenerator, generateADRMarkdown, getADRFilename, generateADRIndexMarkdown } from "./adr.js";
import { BacklogGenerator, generateBacklogMarkdown, generateSprintMarkdown } from "./backlog.js";
import type { LLMProvider } from "../../providers/types.js";
// FileSystemError reserved for future use

/**
 * ORCHESTRATE phase executor
 */
export class OrchestrateExecutor implements PhaseExecutor {
  readonly name = "orchestrate";
  readonly description = "Design architecture, create ADRs, and generate backlog";

  private config: OrchestrateConfig;

  constructor(config: Partial<OrchestrateConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATE_CONFIG, ...config };
  }

  /**
   * Check if the phase can start
   */
  canStart(_context: PhaseContext): boolean {
    // ORCHESTRATE requires a specification from CONVERGE
    // For now, check if spec file exists
    return true;
  }

  /**
   * Execute the ORCHESTRATE phase
   */
  async execute(context: PhaseContext): Promise<PhaseResult> {
    const startTime = new Date();
    const artifacts: PhaseArtifact[] = [];

    try {
      // Load specification from CONVERGE phase
      const specification = await this.loadSpecification(context.projectPath);

      // Create LLM adapter
      const llm = this.createLLMAdapter(context);

      // Create generators
      const archGenerator = new ArchitectureGenerator(llm, this.config);
      const adrGenerator = new ADRGenerator(llm, this.config);
      const backlogGenerator = new BacklogGenerator(llm, this.config);

      // Generate architecture
      const architecture = await archGenerator.generate(specification);
      const archPath = await this.saveArchitecture(context.projectPath, architecture);
      artifacts.push({
        type: "architecture",
        path: archPath,
        description: "Architecture documentation",
      });

      // Generate ADRs
      const adrs = await adrGenerator.generate(architecture, specification);
      const adrPaths = await this.saveADRs(context.projectPath, adrs);
      for (const adrPath of adrPaths) {
        artifacts.push({
          type: "adr",
          path: adrPath,
          description: "Architecture Decision Record",
        });
      }

      // Generate backlog
      const backlogResult = await backlogGenerator.generate(
        architecture,
        specification
      );
      const backlogPath = await this.saveBacklog(context.projectPath, backlogResult);
      artifacts.push({
        type: "backlog",
        path: backlogPath,
        description: "Project backlog",
      });

      // Plan first sprint
      const firstSprint = await backlogGenerator.planFirstSprint(
        backlogResult.backlog
      );
      const sprintPath = await this.saveSprint(
        context.projectPath,
        firstSprint,
        backlogResult
      );
      artifacts.push({
        type: "backlog",
        path: sprintPath,
        description: "Sprint 1 plan",
      });

      // Save diagrams
      for (const diagram of architecture.diagrams) {
        const diagramPath = await this.saveDiagram(
          context.projectPath,
          diagram.id,
          diagram.mermaid
        );
        artifacts.push({
          type: "diagram",
          path: diagramPath,
          description: diagram.title,
        });
      }

      const endTime = new Date();

      return {
        phase: "orchestrate",
        success: true,
        artifacts,
        metrics: {
          startTime,
          endTime,
          durationMs: endTime.getTime() - startTime.getTime(),
          llmCalls: adrs.length + 3, // Approximate
          tokensUsed: 0, // Would need tracking
        },
      };
    } catch (error) {
      return {
        phase: "orchestrate",
        success: false,
        artifacts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if the phase can complete
   */
  canComplete(_context: PhaseContext): boolean {
    // Can complete if we have architecture and backlog
    return true;
  }

  /**
   * Create a checkpoint
   */
  async checkpoint(_context: PhaseContext): Promise<PhaseCheckpoint> {
    return {
      phase: "orchestrate",
      timestamp: new Date(),
      state: {
        artifacts: [],
        progress: 0,
        checkpoint: null,
      },
      resumePoint: "start",
    };
  }

  /**
   * Restore from checkpoint
   */
  async restore(
    _checkpoint: PhaseCheckpoint,
    _context: PhaseContext
  ): Promise<void> {
    // ORCHESTRATE is typically fast enough to re-run
  }

  // Private methods

  private createLLMAdapter(context: PhaseContext): LLMProvider {
    const llmContext = context.llm;

    return {
      id: "phase-adapter",
      name: "Phase LLM Adapter",

      async initialize() {},

      async chat(messages) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        const response = await llmContext.chat(adapted);
        return {
          id: `chat-${Date.now()}`,
          content: response.content,
          stopReason: "end_turn" as const,
          usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          },
          model: "phase-adapter",
        };
      },

      async chatWithTools(messages, options) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        const tools = options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        }));
        const response = await llmContext.chatWithTools(adapted, tools);
        return {
          id: `chat-${Date.now()}`,
          content: response.content,
          stopReason: "end_turn" as const,
          usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          },
          model: "phase-adapter",
          toolCalls: (response.toolCalls || []).map((tc) => ({
            id: tc.name,
            name: tc.name,
            input: tc.arguments,
          })),
        };
      },

      async *stream(messages) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        const response = await llmContext.chat(adapted);
        yield {
          type: "text" as const,
          text: response.content,
        };
        yield {
          type: "done" as const,
        };
      },

      countTokens(_text: string): number {
        return Math.ceil(_text.length / 4);
      },

      getContextWindow(): number {
        return 200000;
      },

      async isAvailable(): Promise<boolean> {
        return true;
      },
    };
  }

  private async loadSpecification(projectPath: string): Promise<Specification> {
    try {
      // Try to load JSON version first
      const jsonPath = path.join(projectPath, ".coco", "spec", "spec.json");
      const jsonContent = await fs.readFile(jsonPath, "utf-8");
      return JSON.parse(jsonContent) as Specification;
    } catch {
      // Fall back to creating a minimal specification
      // In real usage, this would parse the markdown or throw
      return this.createMinimalSpec(projectPath);
    }
  }

  private createMinimalSpec(projectPath: string): Specification {
    return {
      version: "1.0.0",
      generatedAt: new Date(),
      overview: {
        name: path.basename(projectPath),
        description: "Project specification",
        goals: [],
        targetUsers: ["developers"],
        successCriteria: [],
      },
      requirements: {
        functional: [],
        nonFunctional: [],
        constraints: [],
      },
      technical: {
        stack: [],
        architecture: "",
        integrations: [],
        deployment: "",
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

  private async saveArchitecture(
    projectPath: string,
    architecture: ArchitectureDoc
  ): Promise<string> {
    const dir = path.join(projectPath, ".coco", "architecture");
    await fs.mkdir(dir, { recursive: true });

    // Save markdown
    const mdPath = path.join(dir, "ARCHITECTURE.md");
    await fs.writeFile(mdPath, generateArchitectureMarkdown(architecture), "utf-8");

    // Save JSON
    const jsonPath = path.join(dir, "architecture.json");
    await fs.writeFile(jsonPath, JSON.stringify(architecture, null, 2), "utf-8");

    return mdPath;
  }

  private async saveADRs(projectPath: string, adrs: ADR[]): Promise<string[]> {
    const dir = path.join(projectPath, ".coco", "architecture", "adrs");
    await fs.mkdir(dir, { recursive: true });

    const paths: string[] = [];

    // Save index
    const indexPath = path.join(dir, "README.md");
    await fs.writeFile(indexPath, generateADRIndexMarkdown(adrs), "utf-8");
    paths.push(indexPath);

    // Save individual ADRs
    for (const adr of adrs) {
      const filename = getADRFilename(adr);
      const adrPath = path.join(dir, filename);
      await fs.writeFile(adrPath, generateADRMarkdown(adr), "utf-8");
      paths.push(adrPath);
    }

    return paths;
  }

  private async saveBacklog(
    projectPath: string,
    backlogResult: BacklogResult
  ): Promise<string> {
    const dir = path.join(projectPath, ".coco", "planning");
    await fs.mkdir(dir, { recursive: true });

    // Save markdown
    const mdPath = path.join(dir, "BACKLOG.md");
    await fs.writeFile(
      mdPath,
      generateBacklogMarkdown(backlogResult.backlog),
      "utf-8"
    );

    // Save JSON
    const jsonPath = path.join(dir, "backlog.json");
    await fs.writeFile(jsonPath, JSON.stringify(backlogResult, null, 2), "utf-8");

    return mdPath;
  }

  private async saveSprint(
    projectPath: string,
    sprint: Sprint,
    backlogResult: BacklogResult
  ): Promise<string> {
    const dir = path.join(projectPath, ".coco", "planning", "sprints");
    await fs.mkdir(dir, { recursive: true });

    const filename = `${sprint.id}.md`;
    const sprintPath = path.join(dir, filename);
    await fs.writeFile(
      sprintPath,
      generateSprintMarkdown(sprint, backlogResult.backlog),
      "utf-8"
    );

    // Also save JSON
    const jsonPath = path.join(dir, `${sprint.id}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(sprint, null, 2), "utf-8");

    return sprintPath;
  }

  private async saveDiagram(
    projectPath: string,
    id: string,
    mermaid: string
  ): Promise<string> {
    const dir = path.join(projectPath, ".coco", "architecture", "diagrams");
    await fs.mkdir(dir, { recursive: true });

    const diagramPath = path.join(dir, `${id}.mmd`);
    await fs.writeFile(diagramPath, mermaid, "utf-8");

    return diagramPath;
  }
}

/**
 * Create an ORCHESTRATE phase executor
 */
export function createOrchestrateExecutor(
  config?: Partial<OrchestrateConfig>
): OrchestrateExecutor {
  return new OrchestrateExecutor(config);
}

/**
 * Run the ORCHESTRATE phase directly
 */
export async function runOrchestratePhase(
  projectPath: string,
  llm: LLMProvider,
  config?: Partial<OrchestrateConfig>
): Promise<OrchestrateOutput | { error: string }> {
  const executor = createOrchestrateExecutor(config);

  const context: PhaseContext = {
    projectPath,
    config: {
      quality: {
        minScore: 85,
        minCoverage: 80,
        maxIterations: 10,
        convergenceThreshold: 2,
      },
      timeouts: {
        phaseTimeout: 3600000,
        taskTimeout: 600000,
        llmTimeout: 120000,
      },
    },
    state: {
      artifacts: [],
      progress: 0,
      checkpoint: null,
    },
    tools: {} as PhaseContext["tools"],
    llm: {
      async chat(messages) {
        const adapted = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const response = await llm.chat(adapted);
        return {
          content: response.content,
          usage: response.usage,
        };
      },
      async chatWithTools(messages, tools) {
        const adaptedMessages = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const adaptedTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as { type: "object"; properties: Record<string, unknown>; required?: string[] },
        }));
        const response = await llm.chatWithTools(adaptedMessages, { tools: adaptedTools });
        return {
          content: response.content,
          usage: response.usage,
          toolCalls: response.toolCalls?.map((tc) => ({
            name: tc.name,
            arguments: tc.input,
          })),
        };
      },
    },
  };

  const result = await executor.execute(context);

  if (result.success) {
    // Load the generated artifacts
    const archPath = result.artifacts.find((a) => a.type === "architecture")?.path;
    const backlogPath = result.artifacts.find((a) => a.type === "backlog" && a.description === "Project backlog")?.path;

    return {
      architecture: {} as ArchitectureDoc, // Would load from file
      adrs: [],
      backlog: {} as BacklogResult,
      firstSprint: {} as Sprint,
      artifactPaths: {
        architecture: archPath || "",
        adrs: result.artifacts.filter((a) => a.type === "adr").map((a) => a.path),
        backlog: backlogPath || "",
        diagrams: result.artifacts.filter((a) => a.type === "diagram").map((a) => a.path),
      },
    };
  }

  return { error: result.error || "Unknown error" };
}
