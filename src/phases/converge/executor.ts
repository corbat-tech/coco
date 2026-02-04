/**
 * CONVERGE Phase Executor
 *
 * Orchestrates the discovery and specification process
 */

import type {
  PhaseExecutor,
  PhaseContext,
  PhaseResult,
  PhaseCheckpoint,
  PhaseArtifact,
} from "../types.js";
import type { DiscoverySession, Question, Specification } from "./types.js";
import { DiscoveryEngine, createDiscoveryEngine } from "./discovery.js";
import {
  SpecificationGenerator,
  createSpecificationGenerator,
} from "./specification.js";
import { SessionManager, createSessionManager, ConvergeStep } from "./persistence.js";
import type { LLMProvider } from "../../providers/types.js";
import { PhaseError } from "../../utils/errors.js";

/**
 * CONVERGE phase configuration
 */
export interface ConvergeConfig {
  /** Maximum rounds of questions */
  maxQuestionRounds: number;

  /** Maximum questions per round */
  maxQuestionsPerRound: number;

  /** Auto-proceed if no critical questions */
  autoProceed: boolean;

  /** Include diagrams in specification */
  includeDiagrams: boolean;

  /** Callback for user interaction */
  onUserInput?: (prompt: string, options?: string[]) => Promise<string>;

  /** Callback for progress updates */
  onProgress?: (step: ConvergeStep, progress: number, message: string) => void;
}

/**
 * Default CONVERGE configuration
 */
export const DEFAULT_CONVERGE_CONFIG: ConvergeConfig = {
  maxQuestionRounds: 3,
  maxQuestionsPerRound: 3,
  autoProceed: false,
  includeDiagrams: true,
};

/**
 * CONVERGE Phase Executor
 *
 * Implements the PhaseExecutor interface for the CONVERGE phase
 */
export class ConvergeExecutor implements PhaseExecutor {
  readonly name = "converge";
  readonly description = "Gather requirements and generate specification";

  private config: ConvergeConfig;
  private discovery: DiscoveryEngine | null = null;
  private specGenerator: SpecificationGenerator | null = null;
  private sessionManager: SessionManager | null = null;
  private currentSession: DiscoverySession | null = null;
  private llm: LLMProvider | null = null;

  constructor(config: Partial<ConvergeConfig> = {}) {
    this.config = { ...DEFAULT_CONVERGE_CONFIG, ...config };
  }

  /**
   * Check if the phase can start
   */
  canStart(_context: PhaseContext): boolean {
    // CONVERGE can always start (it's the first phase)
    return true;
  }

  /**
   * Execute the CONVERGE phase
   */
  async execute(context: PhaseContext): Promise<PhaseResult> {
    const startTime = new Date();
    const artifacts: PhaseArtifact[] = [];

    try {
      // Initialize components
      await this.initialize(context);

      // Check for existing session to resume
      const resumeData = await this.sessionManager!.resume();

      if (resumeData) {
        this.currentSession = resumeData.session;
        this.discovery!.resumeSession(this.currentSession);
        this.reportProgress(
          resumeData.checkpoint.step,
          resumeData.checkpoint.progress,
          "Resuming from checkpoint"
        );
      } else {
        // Get initial input from user
        const initialInput = await this.getUserInput(
          "Please describe the project you want to build:",
          undefined
        );

        // Start discovery
        this.reportProgress("discovery", 10, "Starting discovery...");
        this.currentSession = await this.discovery!.startSession(initialInput);
        await this.saveProgress("discovery", 15);
      }

      // Run discovery loop
      await this.runDiscoveryLoop();

      // Mark discovery complete
      this.discovery!.markComplete();
      this.reportProgress("spec_generation", 80, "Generating specification...");

      // Generate specification
      const spec = await this.specGenerator!.generate(this.currentSession!);
      const specMarkdown = this.specGenerator!.generateMarkdown(spec);

      // Save everything
      await this.sessionManager!.complete(this.currentSession!, specMarkdown);

      // Create artifacts
      artifacts.push({
        type: "specification",
        path: this.sessionManager!.getPersistence().getSpecPath(),
        description: "Project specification document",
      });

      this.reportProgress("complete", 100, "CONVERGE phase complete");

      const endTime = new Date();

      return {
        phase: "converge",
        success: true,
        artifacts,
        metrics: {
          startTime,
          endTime,
          durationMs: endTime.getTime() - startTime.getTime(),
          llmCalls: this.currentSession!.conversation.length,
          tokensUsed: 0, // Would need to track this
        },
      };
    } catch (error) {
      return {
        phase: "converge",
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
    if (!this.discovery || !this.currentSession) return false;

    // Can complete if discovery is done and no critical questions remain
    return (
      this.discovery.isComplete() ||
      this.discovery.getCriticalQuestions().length === 0
    );
  }

  /**
   * Create a checkpoint for recovery
   */
  async checkpoint(_context: PhaseContext): Promise<PhaseCheckpoint> {
    const step = this.getCurrentStep();
    const progress = this.calculateProgress();

    if (this.currentSession && this.sessionManager) {
      await this.sessionManager.saveWithCheckpoint(
        this.currentSession,
        step,
        progress
      );
    }

    return {
      phase: "converge",
      timestamp: new Date(),
      state: {
        artifacts: [],
        progress,
        checkpoint: null,
      },
      resumePoint: step,
    };
  }

  /**
   * Restore from a checkpoint
   */
  async restore(
    _checkpoint: PhaseCheckpoint,
    context: PhaseContext
  ): Promise<void> {
    await this.initialize(context);

    const resumeData = await this.sessionManager!.resume();
    if (resumeData) {
      this.currentSession = resumeData.session;
      this.discovery!.resumeSession(this.currentSession);
    }
  }

  // Private methods

  private async initialize(context: PhaseContext): Promise<void> {
    // Create LLM adapter from context
    this.llm = this.createLLMAdapter(context);

    // Initialize components
    this.discovery = createDiscoveryEngine(this.llm, {
      maxQuestionsPerRound: this.config.maxQuestionsPerRound,
    });

    this.specGenerator = createSpecificationGenerator(this.llm, {
      includeDiagrams: this.config.includeDiagrams,
    });

    this.sessionManager = createSessionManager(context.projectPath);
  }

  private createLLMAdapter(context: PhaseContext): LLMProvider {
    // Adapt the phase context LLM interface to our LLMProvider interface
    const llmContext = context.llm;

    return {
      id: "phase-adapter",
      name: "Phase LLM Adapter",

      async initialize() {},

      async chat(messages) {
        // Convert provider Message to phase Message (content can be string or array)
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
        // Convert provider Message to phase Message
        const adapted = messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }));
        // Convert provider ToolDefinition to phase ToolDefinition
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

      async *streamWithTools(messages, options) {
        // Fallback to chatWithTools for adapters (no real streaming support)
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

        // Yield text if present
        if (response.content) {
          yield {
            type: "text" as const,
            text: response.content,
          };
        }

        // Yield tool calls
        for (const tc of response.toolCalls || []) {
          yield {
            type: "tool_use_start" as const,
            toolCall: {
              id: tc.name,
              name: tc.name,
            },
          };
          yield {
            type: "tool_use_end" as const,
            toolCall: {
              id: tc.name,
              name: tc.name,
              input: tc.arguments,
            },
          };
        }

        yield {
          type: "done" as const,
        };
      },

      countTokens(_text: string): number {
        // Approximate token count
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

  private async runDiscoveryLoop(): Promise<void> {
    let round = 0;

    while (round < this.config.maxQuestionRounds) {
      round++;

      // Check if we can proceed
      const criticalQuestions = this.discovery!.getCriticalQuestions();

      if (criticalQuestions.length === 0 && this.config.autoProceed) {
        break;
      }

      // Generate questions if needed
      const openQuestions = this.discovery!.getOpenQuestions();

      if (openQuestions.length === 0) {
        const newQuestions = await this.discovery!.generateQuestions();
        if (newQuestions.length === 0) {
          break; // No more questions to ask
        }
      }

      // Ask questions
      const questions = this.discovery!.getOpenQuestions();

      if (questions.length === 0) {
        break;
      }

      this.reportProgress(
        "clarification",
        30 + round * 15,
        `Asking clarification questions (round ${round})`
      );

      // Process each question
      for (const question of questions) {
        const answer = await this.askQuestion(question);

        if (answer.toLowerCase() === "skip") {
          // Use default answer if available
          if (question.defaultAnswer) {
            await this.discovery!.processAnswer(
              question.id,
              question.defaultAnswer
            );
          }
          continue;
        }

        if (answer.toLowerCase() === "done") {
          // User wants to finish
          return;
        }

        await this.discovery!.processAnswer(question.id, answer);
      }

      // Save progress
      await this.saveProgress("clarification", 30 + round * 15);
    }
  }

  private async askQuestion(question: Question): Promise<string> {
    let prompt = question.question;

    if (question.context) {
      prompt += `\n\nContext: ${question.context}`;
    }

    if (question.options && question.options.length > 0) {
      prompt += "\n\nOptions:";
      for (let i = 0; i < question.options.length; i++) {
        prompt += `\n${i + 1}. ${question.options[i]}`;
      }
    }

    if (question.defaultAnswer) {
      prompt += `\n\n(Default: ${question.defaultAnswer}, type 'skip' to use default)`;
    }

    prompt += "\n\n(Type 'done' to finish questions and proceed)";

    return this.getUserInput(prompt, question.options);
  }

  private async getUserInput(
    prompt: string,
    options?: string[]
  ): Promise<string> {
    if (this.config.onUserInput) {
      return this.config.onUserInput(prompt, options);
    }

    // Default implementation that throws - in real usage, a callback should be provided
    throw new PhaseError(
      "No user input handler configured",
      { phase: "converge" }
    );
  }

  private reportProgress(
    step: ConvergeStep,
    progress: number,
    message: string
  ): void {
    if (this.config.onProgress) {
      this.config.onProgress(step, progress, message);
    }
  }

  private async saveProgress(
    step: ConvergeStep,
    progress: number
  ): Promise<void> {
    if (this.currentSession && this.sessionManager) {
      await this.sessionManager.saveWithCheckpoint(
        this.currentSession,
        step,
        progress
      );
    }
  }

  private getCurrentStep(): ConvergeStep {
    if (!this.currentSession) return "init";

    switch (this.currentSession.status) {
      case "gathering":
        return "discovery";
      case "clarifying":
        return "clarification";
      case "refining":
        return "refinement";
      case "complete":
        return "spec_generation";
      case "spec_generated":
        return "complete";
      default:
        return "discovery";
    }
  }

  private calculateProgress(): number {
    if (!this.currentSession) return 0;

    const step = this.getCurrentStep();
    const stepProgress: Record<ConvergeStep, number> = {
      init: 0,
      discovery: 20,
      clarification: 50,
      refinement: 70,
      spec_generation: 90,
      complete: 100,
    };

    return stepProgress[step] || 0;
  }
}

/**
 * Create a CONVERGE phase executor
 */
export function createConvergeExecutor(
  config?: Partial<ConvergeConfig>
): ConvergeExecutor {
  return new ConvergeExecutor(config);
}

/**
 * Create LLM adapter for phase context
 * Converts between provider types and phase types
 */
export function createLLMAdapter(llm: LLMProvider): PhaseContext["llm"] {
  return {
    async chat(messages) {
      // Convert phase Message to provider Message
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
      // Convert phase Message to provider Message
      const adaptedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      // Convert phase ToolDefinition to provider ToolDefinition
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
  };
}

/**
 * Run the CONVERGE phase directly (convenience function)
 */
export async function runConvergePhase(
  projectPath: string,
  llm: LLMProvider,
  config?: Partial<ConvergeConfig>
): Promise<{
  success: boolean;
  specification?: Specification;
  specPath?: string;
  error?: string;
}> {
  const executor = createConvergeExecutor(config);

  // Create a minimal phase context
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
        phaseTimeout: 3600000, // 1 hour
        taskTimeout: 600000, // 10 minutes
        llmTimeout: 120000, // 2 minutes
      },
    },
    state: {
      artifacts: [],
      progress: 0,
      checkpoint: null,
    },
    tools: {} as PhaseContext["tools"], // Not used in CONVERGE
    llm: createLLMAdapter(llm),
  };

  const result = await executor.execute(context);

  if (result.success) {
    const specArtifact = result.artifacts.find(
      (a) => a.type === "specification"
    );

    return {
      success: true,
      specPath: specArtifact?.path,
    };
  }

  return {
    success: false,
    error: result.error,
  };
}
