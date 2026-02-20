/**
 * Swarm Orchestrator Entry Point
 *
 * The SwarmOrchestrator is the top-level API for running the swarm pipeline.
 * It loads the spec, initializes the provider, and runs the full lifecycle.
 */

import { parseSwarmSpec } from "./spec-parser.js";
import { loadAgentConfig } from "./agents/config.js";
import { runSwarmLifecycle } from "./lifecycle.js";
import { createProvider } from "../providers/index.js";
import type { ProviderType } from "../providers/index.js";

/**
 * Options for running the SwarmOrchestrator
 */
export interface SwarmOrchestratorOptions {
  /** Path to the YAML or Markdown spec file */
  specFile: string;
  /** Directory to write output artifacts */
  outputPath: string;
  /** Minimum quality score (default: 85) */
  minScore?: number;
  /** Maximum iterations per feature (default: 10) */
  maxIterations?: number;
  /** LLM provider type (default: "anthropic") */
  providerType?: string;
  /** Model override (default: provider's default) */
  model?: string;
  /** Never ask questions, always assume best option */
  noQuestions?: boolean;
  /** Maximum parallel agents (default: auto/4) */
  maxParallel?: number;
  /** Resume from last checkpoint */
  resume?: boolean;
  /** Progress callback */
  onProgress?: (state: string, message: string) => void;
}

/**
 * Swarm Orchestrator
 *
 * Drives the full swarm pipeline for a given spec file.
 */
export class SwarmOrchestrator {
  /**
   * Run the swarm orchestrator.
   *
   * This is the main entry point. It:
   * 1. Parses the spec file
   * 2. Initializes the LLM provider
   * 3. Loads agent configuration (from .coco/swarm/agents.json or defaults)
   * 4. Runs the full lifecycle
   */
  async run(options: SwarmOrchestratorOptions): Promise<void> {
    const {
      specFile,
      outputPath,
      minScore = 85,
      maxIterations = 10,
      providerType = "anthropic",
      model,
      noQuestions = false,
      onProgress,
    } = options;

    // Resolve project path as the directory containing the spec file
    const path = await import("node:path");
    const projectPath = path.dirname(path.resolve(specFile));

    onProgress?.("init", `Parsing spec file: ${specFile}`);
    const spec = await parseSwarmSpec(specFile);

    onProgress?.("init", `Initializing provider: ${providerType}`);
    const provider = await createProvider(providerType as ProviderType, {
      model: model || undefined,
    });

    const agentConfig = await loadAgentConfig(projectPath);

    await runSwarmLifecycle({
      spec,
      projectPath,
      outputPath: path.resolve(outputPath),
      provider,
      agentConfig,
      minScore,
      maxIterations,
      noQuestions,
      onProgress: onProgress as
        | ((state: import("./lifecycle.js").SwarmState, message: string) => void)
        | undefined,
    });
  }
}

/**
 * Factory function for creating a SwarmOrchestrator
 */
export function createSwarmOrchestrator(): SwarmOrchestrator {
  return new SwarmOrchestrator();
}

// Re-export types for consumers
export type { SwarmSpec, SwarmFeature, SwarmTechStack } from "./spec-parser.js";
export type { SwarmAgentRole, SwarmGate, SwarmAgentDefinition } from "./agents/types.js";
export type { AgentModelConfig, AgentConfigMap } from "./agents/config.js";
export type { SwarmTask, SwarmBoard, SwarmTaskType, SwarmTaskStatus } from "./task-board.js";
export type { SwarmEvent } from "./events.js";
export type { KnowledgeEntry } from "./knowledge.js";
export type { SwarmState, SwarmGateResult, SwarmLifecycleOptions } from "./lifecycle.js";
export type { ClarificationQuestion, ClarificationResult } from "./clarifier.js";
