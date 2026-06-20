import {
  AgentRunner,
  type AgentRunnerExecutionInput,
  type AgentRunnerOptions,
} from "./agent-runner.js";
import { evaluateRuntimeToolPolicy, type RuntimePolicy } from "./context.js";
import {
  evaluateAgentToolPolicy,
  normalizeAgentRunResult,
  type AgentDefinition,
  type AgentGraphNodeExecution,
  type AgentGraphNodeExecutor,
  type AgentRole,
  type AgentRunResult,
  type ToolRiskManifest,
} from "./multi-agent.js";

export class AgentDefinitionRegistry {
  private readonly definitionsByRole = new Map<AgentRole, AgentDefinition>();
  private readonly definitionsById = new Map<string, AgentDefinition>();

  constructor(definitions: AgentDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: AgentDefinition): void {
    this.definitionsById.set(definition.id, cloneDefinition(definition));
    this.definitionsByRole.set(definition.role, cloneDefinition(definition));
  }

  get(id: string): AgentDefinition | undefined {
    const definition = this.definitionsById.get(id);
    return definition ? cloneDefinition(definition) : undefined;
  }

  getByRole(role: AgentRole): AgentDefinition | undefined {
    const definition = this.definitionsByRole.get(role);
    return definition ? cloneDefinition(definition) : undefined;
  }

  list(): AgentDefinition[] {
    return [...this.definitionsById.values()].map(cloneDefinition);
  }
}

export interface RuntimeAgentNodeExecutorOptions {
  registry: AgentDefinitionRegistry;
  runner?: AgentRunner;
  runnerOptions?: AgentRunnerOptions;
  runtimePolicy?: RuntimePolicy;
  toolRiskManifest?: ToolRiskManifest;
}

export class RuntimeAgentNodeExecutor {
  private readonly runner: AgentRunner;

  constructor(private readonly options: RuntimeAgentNodeExecutorOptions) {
    this.runner = options.runner ?? new AgentRunner(options.runnerOptions);
  }

  execute: AgentGraphNodeExecutor = async (
    execution: AgentGraphNodeExecution,
  ): Promise<AgentRunResult> => {
    const startedAt = new Date().toISOString();
    const definition = this.options.registry.getByRole(execution.task.role);
    if (!definition) {
      return normalizeAgentRunResult({
        id: `${execution.workflowRunId}-${execution.node.id}-missing-definition`,
        taskId: execution.task.id,
        role: execution.task.role,
        success: false,
        output: "",
        startedAt,
        completedAt: new Date().toISOString(),
        error: `No agent definition registered for role '${execution.task.role}'.`,
        metadata: {
          workflowRunId: execution.workflowRunId,
          nodeId: execution.node.id,
          trace: execution.trace,
        },
      });
    }

    const blockedTool = this.findBlockedTool(definition, execution);
    if (blockedTool) {
      return normalizeAgentRunResult({
        id: `${execution.workflowRunId}-${execution.node.id}-policy-blocked`,
        taskId: execution.task.id,
        role: execution.task.role,
        success: false,
        output: "",
        startedAt,
        completedAt: new Date().toISOString(),
        error: blockedTool,
        metadata: {
          workflowRunId: execution.workflowRunId,
          nodeId: execution.node.id,
          agentDefinitionId: definition.id,
          trace: execution.trace,
        },
      });
    }

    const input: AgentRunnerExecutionInput = {
      task: {
        ...execution.task,
        context: {
          ...execution.task.context,
          instructions: definition.instructions,
          sharedState: execution.sharedState.readForRole(definition.role),
        },
      },
      capability: definition.capability,
      trace: execution.trace,
      toolRiskManifest: this.options.toolRiskManifest,
    };
    const result = await this.runner.run(input);
    return normalizeAgentRunResult({
      ...result,
      metadata: {
        ...result.metadata,
        workflowRunId: execution.workflowRunId,
        nodeId: execution.node.id,
        agentDefinitionId: definition.id,
      },
    });
  };

  private findBlockedTool(
    definition: AgentDefinition,
    execution: AgentGraphNodeExecution,
  ): string | undefined {
    for (const toolName of execution.node.requiredTools ?? []) {
      const agentDecision = evaluateAgentToolPolicy({
        capability: definition.capability,
        toolName,
        manifest: this.options.toolRiskManifest,
      });
      execution.eventLog.record("agent.tool.called", {
        workflowRunId: execution.workflowRunId,
        nodeId: execution.node.id,
        taskId: execution.task.id,
        role: execution.task.role,
        toolName,
        decision: agentDecision,
        trace: execution.trace,
      });
      if (!agentDecision.allowed) {
        return agentDecision.reason ?? `Tool '${toolName}' is not allowed for agent.`;
      }
      const runtimeDecision = evaluateRuntimeToolPolicy(this.options.runtimePolicy, {
        toolName,
        risk: agentDecision.risk,
      });
      if (!runtimeDecision.allowed) {
        return runtimeDecision.reason ?? `Tool '${toolName}' is blocked by runtime policy.`;
      }
    }
    return undefined;
  }
}

export function createAgentDefinitionRegistry(
  definitions: AgentDefinition[] = [],
): AgentDefinitionRegistry {
  return new AgentDefinitionRegistry(definitions);
}

export function createRuntimeAgentNodeExecutor(
  options: RuntimeAgentNodeExecutorOptions,
): AgentGraphNodeExecutor {
  return new RuntimeAgentNodeExecutor(options).execute;
}

function cloneDefinition(definition: AgentDefinition): AgentDefinition {
  return structuredClone(definition);
}
