/**
 * Types for the ORCHESTRATE phase
 *
 * This phase focuses on architecture design, ADR creation, and backlog generation
 */

import type { Specification } from "../converge/types.js";
import type { Sprint, Backlog } from "../../types/task.js";

/**
 * Architecture document
 */
export interface ArchitectureDoc {
  version: string;
  generatedAt: Date;

  /** High-level overview */
  overview: ArchitectureOverview;

  /** System components */
  components: Component[];

  /** Component relationships */
  relationships: Relationship[];

  /** Data models */
  dataModels: DataModel[];

  /** External integrations */
  integrations: Integration[];

  /** Diagrams */
  diagrams: ArchitectureDiagram[];
}

/**
 * Architecture overview
 */
export interface ArchitectureOverview {
  pattern: ArchitecturePattern;
  description: string;
  principles: string[];
  qualityAttributes: QualityAttribute[];
}

/**
 * Architecture patterns
 */
export type ArchitecturePattern =
  | "layered"
  | "hexagonal"
  | "clean"
  | "microservices"
  | "event_driven"
  | "cqrs"
  | "modular_monolith"
  | "serverless";

/**
 * Quality attribute
 */
export interface QualityAttribute {
  name: string;
  description: string;
  priority: "high" | "medium" | "low";
  tradeoffs?: string[];
}

/**
 * System component
 */
export interface Component {
  id: string;
  name: string;
  type: ComponentType;
  description: string;
  responsibilities: string[];
  technology?: string;
  layer?: string;
  dependencies: string[];
}

/**
 * Component types
 */
export type ComponentType =
  | "service"
  | "controller"
  | "repository"
  | "adapter"
  | "port"
  | "domain"
  | "usecase"
  | "utility"
  | "external";

/**
 * Relationship between components
 */
export interface Relationship {
  from: string;
  to: string;
  type: RelationshipType;
  description?: string;
}

/**
 * Relationship types
 */
export type RelationshipType =
  | "uses"
  | "implements"
  | "extends"
  | "depends"
  | "calls"
  | "publishes"
  | "subscribes";

/**
 * Data model
 */
export interface DataModel {
  name: string;
  description: string;
  fields: DataField[];
  relationships: DataRelationship[];
}

/**
 * Data field
 */
export interface DataField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/**
 * Data relationship
 */
export interface DataRelationship {
  type: "one_to_one" | "one_to_many" | "many_to_many";
  target: string;
  description?: string;
}

/**
 * External integration
 */
export interface Integration {
  name: string;
  type: IntegrationType;
  description: string;
  endpoint?: string;
  authentication?: string;
}

/**
 * Integration types
 */
export type IntegrationType =
  | "rest_api"
  | "graphql"
  | "grpc"
  | "database"
  | "message_queue"
  | "file_system"
  | "external_service";

/**
 * Architecture diagram
 */
export interface ArchitectureDiagram {
  id: string;
  type: DiagramType;
  title: string;
  description: string;
  mermaid: string;
}

/**
 * Diagram types (C4 model + others)
 */
export type DiagramType =
  | "c4_context"
  | "c4_container"
  | "c4_component"
  | "c4_code"
  | "sequence"
  | "class"
  | "er"
  | "flowchart";

/**
 * Architecture Decision Record
 */
export interface ADR {
  id: string;
  number: number;
  title: string;
  date: Date;
  status: ADRStatus;
  context: string;
  decision: string;
  consequences: ADRConsequences;
  alternatives?: Alternative[];
  references?: string[];
}

/**
 * ADR status
 */
export type ADRStatus =
  | "proposed"
  | "accepted"
  | "deprecated"
  | "superseded";

/**
 * ADR consequences
 */
export interface ADRConsequences {
  positive: string[];
  negative: string[];
  neutral?: string[];
}

/**
 * Alternative considered in ADR
 */
export interface Alternative {
  option: string;
  pros: string[];
  cons: string[];
  reason: string;
}

/**
 * Standard templates for ADRs
 */
export interface ADRTemplate {
  id: string;
  category: string;
  title: string;
  contextTemplate: string;
  decisionTemplate: string;
}

/**
 * Backlog generation result
 */
export interface BacklogResult {
  backlog: Backlog;
  estimatedSprints: number;
  estimatedVelocity: number;
  warnings: string[];
}

/**
 * Sprint planning configuration
 */
export interface SprintConfig {
  /** Sprint duration in days */
  sprintDuration: number;

  /** Target velocity (story points per sprint) */
  targetVelocity: number;

  /** Maximum stories per sprint */
  maxStoriesPerSprint: number;

  /** Include buffer for unexpected work */
  bufferPercentage: number;
}

/**
 * Default sprint configuration
 */
export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  sprintDuration: 14,
  targetVelocity: 20,
  maxStoriesPerSprint: 8,
  bufferPercentage: 20,
};

/**
 * Task breakdown strategy
 */
export type TaskBreakdownStrategy =
  | "by_layer"      // Break down by architectural layers
  | "by_feature"    // Break down by feature/story
  | "by_component"  // Break down by component
  | "tdd"          // Test-first approach
  | "incremental"; // Small incremental changes

/**
 * ORCHESTRATE phase configuration
 */
export interface OrchestrateConfig {
  /** Generate C4 diagrams */
  generateC4Diagrams: boolean;

  /** Generate sequence diagrams */
  generateSequenceDiagrams: boolean;

  /** Number of ADRs to generate for key decisions */
  maxADRs: number;

  /** Sprint configuration */
  sprint: SprintConfig;

  /** Task breakdown strategy */
  breakdownStrategy: TaskBreakdownStrategy;

  /** Generate deployment docs */
  generateDeploymentDocs: boolean;
}

/**
 * Default ORCHESTRATE configuration
 */
export const DEFAULT_ORCHESTRATE_CONFIG: OrchestrateConfig = {
  generateC4Diagrams: true,
  generateSequenceDiagrams: true,
  maxADRs: 10,
  sprint: DEFAULT_SPRINT_CONFIG,
  breakdownStrategy: "tdd",
  generateDeploymentDocs: true,
};

/**
 * ORCHESTRATE phase output
 */
export interface OrchestrateOutput {
  /** Generated architecture document */
  architecture: ArchitectureDoc;

  /** Generated ADRs */
  adrs: ADR[];

  /** Generated backlog */
  backlog: BacklogResult;

  /** First sprint ready to execute */
  firstSprint: Sprint;

  /** File paths of generated artifacts */
  artifactPaths: {
    architecture: string;
    adrs: string[];
    backlog: string;
    diagrams: string[];
  };
}

/**
 * Input to ORCHESTRATE phase
 */
export interface OrchestrateInput {
  /** Specification from CONVERGE phase */
  specification: Specification;

  /** Project path */
  projectPath: string;

  /** Configuration */
  config: OrchestrateConfig;
}
