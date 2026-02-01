/**
 * Types for the CONVERGE phase
 *
 * This phase focuses on requirement discovery and specification generation
 */

/**
 * Discovery session state
 */
export interface DiscoverySession {
  id: string;
  startedAt: Date;
  updatedAt: Date;
  status: DiscoveryStatus;

  /** Initial user input */
  initialInput: string;

  /** Conversation history */
  conversation: DiscoveryMessage[];

  /** Extracted requirements */
  requirements: Requirement[];

  /** Open questions */
  openQuestions: Question[];

  /** Clarifications received */
  clarifications: Clarification[];

  /** Assumptions made */
  assumptions: Assumption[];

  /** Technology decisions */
  techDecisions: TechDecision[];
}

/**
 * Discovery session status
 */
export type DiscoveryStatus =
  | "gathering"      // Still gathering requirements
  | "clarifying"     // Asking follow-up questions
  | "refining"       // Refining requirements
  | "complete"       // Ready to generate spec
  | "spec_generated"; // Spec has been created

/**
 * Message in discovery conversation
 */
export interface DiscoveryMessage {
  id: string;
  timestamp: Date;
  role: "user" | "assistant";
  content: string;

  /** Extracted data from this message */
  extracted?: {
    requirements?: string[];
    questions?: string[];
    decisions?: string[];
  };
}

/**
 * A requirement gathered from discovery
 */
export interface Requirement {
  id: string;
  category: RequirementCategory;
  priority: RequirementPriority;
  title: string;
  description: string;

  /** Source message ID */
  sourceMessageId: string;

  /** Whether this is explicitly stated or inferred */
  explicit: boolean;

  /** Acceptance criteria */
  acceptanceCriteria?: string[];

  /** Related requirements */
  relatedTo?: string[];

  /** Status */
  status: "draft" | "confirmed" | "removed";
}

/**
 * Requirement categories
 */
export type RequirementCategory =
  | "functional"       // What the system should do
  | "non_functional"   // Performance, security, etc.
  | "technical"        // Technology constraints
  | "user_experience"  // UX requirements
  | "integration"      // External integrations
  | "deployment"       // Deployment requirements
  | "constraint";      // Limitations or restrictions

/**
 * Requirement priority
 */
export type RequirementPriority =
  | "must_have"    // Critical - system won't work without
  | "should_have"  // Important - high value
  | "could_have"   // Nice to have
  | "wont_have";   // Explicitly out of scope

/**
 * A question to ask the user
 */
export interface Question {
  id: string;
  category: QuestionCategory;
  question: string;
  context: string;
  importance: "critical" | "important" | "helpful";

  /** Default answer if user doesn't respond */
  defaultAnswer?: string;

  /** Suggested options */
  options?: string[];

  /** Whether this has been asked */
  asked: boolean;

  /** User's answer */
  answer?: string;
}

/**
 * Question categories
 */
export type QuestionCategory =
  | "clarification"   // Clarifying ambiguous requirement
  | "expansion"       // Expanding on a topic
  | "decision"        // Choosing between options
  | "confirmation"    // Confirming an assumption
  | "scope"           // Defining scope
  | "priority";       // Prioritization

/**
 * A clarification received from user
 */
export interface Clarification {
  questionId: string;
  answer: string;
  timestamp: Date;

  /** Requirements affected by this clarification */
  affectedRequirements: string[];

  /** New requirements created from this */
  newRequirements?: string[];
}

/**
 * An assumption made during discovery
 */
export interface Assumption {
  id: string;
  category: string;
  statement: string;
  confidence: "high" | "medium" | "low";

  /** Whether user has confirmed this */
  confirmed: boolean;

  /** Impact if wrong */
  impactIfWrong: string;
}

/**
 * A technology decision
 */
export interface TechDecision {
  id: string;
  area: TechArea;
  decision: string;
  alternatives: string[];
  rationale: string;

  /** Whether explicitly requested or recommended */
  explicit: boolean;

  /** Impact on other decisions */
  impact?: string[];
}

/**
 * Technology areas
 */
export type TechArea =
  | "language"       // Programming language
  | "framework"      // Framework choice
  | "database"       // Database system
  | "infrastructure" // Cloud, containers, etc.
  | "testing"        // Testing framework
  | "ci_cd"          // CI/CD tools
  | "monitoring"     // Monitoring/logging
  | "security";      // Security measures

/**
 * Generated specification document
 */
export interface Specification {
  version: string;
  generatedAt: Date;

  /** Project overview */
  overview: ProjectOverview;

  /** All requirements organized */
  requirements: RequirementsSection;

  /** Technical specifications */
  technical: TechnicalSection;

  /** Assumptions and risks */
  assumptions: AssumptionsSection;

  /** Out of scope items */
  outOfScope: string[];

  /** Open questions (if any remain) */
  openQuestions: Question[];
}

/**
 * Project overview section
 */
export interface ProjectOverview {
  name: string;
  description: string;
  goals: string[];
  targetUsers: string[];
  successCriteria: string[];
}

/**
 * Requirements section
 */
export interface RequirementsSection {
  functional: Requirement[];
  nonFunctional: Requirement[];
  constraints: Requirement[];
}

/**
 * Technical specifications section
 */
export interface TechnicalSection {
  stack: TechDecision[];
  architecture: string;
  integrations: string[];
  deployment: string;
}

/**
 * Assumptions section
 */
export interface AssumptionsSection {
  confirmed: Assumption[];
  unconfirmed: Assumption[];
  risks: Risk[];
}

/**
 * A project risk
 */
export interface Risk {
  id: string;
  description: string;
  probability: "high" | "medium" | "low";
  impact: "high" | "medium" | "low";
  mitigation: string;
}

/**
 * Discovery engine configuration
 */
export interface DiscoveryConfig {
  /** Maximum questions to ask in a single round */
  maxQuestionsPerRound: number;

  /** Minimum requirements before proceeding */
  minRequirements: number;

  /** Whether to auto-confirm low-confidence assumptions */
  autoConfirmLowConfidence: boolean;

  /** Default language if not specified */
  defaultLanguage: "typescript" | "python" | "go" | "rust" | "java";

  /** Whether to generate diagrams in spec */
  includeDiagrams: boolean;
}

/**
 * Discovery prompt templates
 */
export interface DiscoveryPrompts {
  systemPrompt: string;
  extractRequirements: string;
  generateQuestions: string;
  confirmAssumptions: string;
  generateSpec: string;
}

/**
 * Result of analyzing user input
 */
export interface InputAnalysis {
  /** Detected project type */
  projectType: ProjectType;

  /** Complexity assessment */
  complexity: "simple" | "moderate" | "complex" | "enterprise";

  /** Completeness of input */
  completeness: number; // 0-100

  /** Extracted requirements */
  requirements: Requirement[];

  /** Questions to ask */
  suggestedQuestions: Question[];

  /** Inferred assumptions */
  assumptions: Assumption[];

  /** Technology hints */
  techHints: Partial<TechDecision>[];
}

/**
 * Project types
 */
export type ProjectType =
  | "cli"           // Command-line tool
  | "api"           // REST/GraphQL API
  | "web_app"       // Web application
  | "library"       // Reusable library
  | "service"       // Background service
  | "full_stack"    // Full stack application
  | "automation"    // Scripts/automation
  | "unknown";      // Cannot determine
