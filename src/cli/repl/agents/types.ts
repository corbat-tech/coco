/**
 * Subagent types for Corbat-Coco
 * Defines the types for specialized agents that can be spawned for different tasks
 */

/**
 * Available agent types for specialized tasks
 */
export type AgentType = "explore" | "plan" | "test" | "debug" | "review";

/**
 * Agent status indicating current state
 */
export type AgentStatus = "idle" | "running" | "completed" | "failed";

/**
 * Subagent instance representing a spawned agent
 */
export interface SubAgent {
  /** Unique identifier for this agent instance */
  id: string;
  /** Type of specialized agent */
  type: AgentType;
  /** Current status of the agent */
  status: AgentStatus;
  /** Task description this agent is working on */
  task: string;
  /** Result output when completed */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Timestamp when agent was created */
  createdAt: Date;
  /** Timestamp when agent completed or failed */
  completedAt?: Date;
}

/**
 * Configuration for spawning a subagent
 */
export interface AgentConfig {
  /** Type of agent to spawn */
  type: AgentType;
  /** System prompt for this agent type */
  systemPrompt: string;
  /** Tool names this agent can use */
  tools: string[];
  /** Maximum number of LLM turns before stopping */
  maxTurns?: number;
}

/**
 * Options for spawning a subagent
 */
export interface SpawnAgentOptions {
  /** Callback when agent status changes */
  onStatusChange?: (agent: SubAgent) => void;
  /** Callback when agent produces intermediate output */
  onOutput?: (agent: SubAgent, output: string) => void;
  /** Signal to abort the agent */
  signal?: AbortSignal;
  /** Timeout in milliseconds for agent execution */
  timeout?: number;
}

/**
 * Event types emitted by AgentManager
 */
export type AgentEventType = "spawn" | "complete" | "fail" | "timeout" | "cancel";

/**
 * Agent event payload
 */
export interface AgentEvent {
  /** Type of event */
  type: AgentEventType;
  /** The agent involved */
  agent: SubAgent;
  /** Result if completed */
  result?: AgentResult;
}

/**
 * Result of agent execution
 */
export interface AgentResult {
  /** The agent instance */
  agent: SubAgent;
  /** Whether execution was successful */
  success: boolean;
  /** Final output or error message */
  output: string;
  /** Token usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Agent registry entry with configuration
 */
export interface AgentRegistryEntry {
  /** Agent type identifier */
  type: AgentType;
  /** Human-readable name */
  name: string;
  /** Description of what this agent does */
  description: string;
  /** Default configuration */
  config: AgentConfig;
}
