import type { ProviderType } from "../providers/index.js";
import type { LLMProvider, ProviderConfig } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createAgentRuntime, type AgentRuntime } from "./agent-runtime.js";
import type {
  EventLog,
  RuntimeSession,
  RuntimeTurnInput,
  RuntimeTurnResult,
  RuntimeTurnRunner,
} from "./types.js";
import type { GuardrailConfig, GuardrailFinding } from "./guardrails.js";
import { defaultPublicGuardrails, runGuardrails } from "./guardrails.js";

export type AgentDeploymentSurface = "cli" | "web" | "whatsapp" | "slack" | "api" | "internal";
export type AgentActionMode = "ask" | "draft" | "act" | "review";
export type AgentMaturity = "experimental" | "beta" | "stable";

export interface MemoryConfig {
  enabled: boolean;
  retention?: "session" | "short-term" | "long-term";
}

export interface ApprovalPolicy {
  requireHumanForExternalActions: boolean;
  requireHumanForSensitiveData?: boolean;
}

export interface ObservabilityConfig {
  logEvents: boolean;
  redactSensitiveData: boolean;
  estimateCost?: boolean;
}

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  surface: AgentDeploymentSurface;
  defaultMode: AgentActionMode;
  maturity: AgentMaturity;
  instructions: string;
  allowedTools: string[];
  guardrails: GuardrailConfig;
  memory: MemoryConfig;
  approval: ApprovalPolicy;
  observability: ObservabilityConfig;
  outputSchema?: unknown;
}

export interface AgentRuntimeFactoryOptions {
  providerType: ProviderType;
  model?: string;
  providerConfig?: ProviderConfig;
  provider?: LLMProvider;
  toolRegistry?: ToolRegistry;
  eventLog?: EventLog;
  turnRunner?: RuntimeTurnRunner;
}

export interface AgentPreset<TConfig = unknown> {
  id: string;
  name: string;
  createBlueprint(config: TConfig): AgentBlueprint;
  createRuntime(config: TConfig & AgentRuntimeFactoryOptions): Promise<AgentRuntime>;
}

export interface BlueprintAgent {
  blueprint: AgentBlueprint;
  runtime: AgentRuntime;
  createSession(metadata?: Record<string, unknown>): RuntimeSession;
  runTurn(input: RuntimeTurnInput): Promise<RuntimeTurnResult>;
}

export function mapActionModeToRuntimeMode(mode: AgentActionMode): "ask" | "build" | "review" {
  if (mode === "act") return "build";
  if (mode === "review") return "review";
  return "ask";
}

export function createSafeToolRegistry(
  allowedTools: string[],
  source?: ToolRegistry,
): ToolRegistry {
  const safe = new ToolRegistry();
  if (!source) return safe;

  for (const toolName of allowedTools) {
    const tool = source.get(toolName);
    if (tool) safe.register(tool);
  }

  return safe;
}

export async function createAgentFromBlueprint(
  blueprint: AgentBlueprint,
  options: AgentRuntimeFactoryOptions,
): Promise<BlueprintAgent> {
  const runtime = await createAgentRuntime({
    providerType: options.providerType,
    model: options.model,
    providerConfig: options.providerConfig,
    provider: options.provider,
    eventLog: options.eventLog,
    turnRunner: options.turnRunner,
    toolRegistry:
      options.toolRegistry ??
      createSafeToolRegistry(blueprint.allowedTools.length > 0 ? blueprint.allowedTools : []),
    publishToGlobalBridge: false,
  });

  return {
    blueprint,
    runtime,
    createSession(metadata = {}) {
      return runtime.createSession({
        mode: mapActionModeToRuntimeMode(blueprint.defaultMode),
        instructions: blueprint.instructions,
        metadata: {
          blueprintId: blueprint.id,
          surface: blueprint.surface,
          ...metadata,
        },
      });
    },
    async runTurn(input) {
      const guardrails = { ...defaultPublicGuardrails, ...blueprint.guardrails };
      const checkedInput = runGuardrails("input", input.content, guardrails);
      runtime.eventLog.record("guardrail.input", {
        blueprintId: blueprint.id,
        allowed: checkedInput.allowed,
        findings: checkedInput.findings,
      } as Record<string, unknown>);
      if (!checkedInput.allowed) {
        throw new Error(formatGuardrailBlock(checkedInput.findings));
      }

      const result = await runtime.runTurn({
        ...input,
        content: checkedInput.content,
        mode: input.mode ?? mapActionModeToRuntimeMode(blueprint.defaultMode),
      });

      const checkedOutput = runGuardrails("output", result.content, guardrails);
      runtime.eventLog.record("guardrail.output", {
        blueprintId: blueprint.id,
        allowed: checkedOutput.allowed,
        findings: checkedOutput.findings,
      } as Record<string, unknown>);
      if (!checkedOutput.allowed) {
        throw new Error(formatGuardrailBlock(checkedOutput.findings));
      }

      return { ...result, content: checkedOutput.content };
    },
  };
}

function formatGuardrailBlock(findings: GuardrailFinding[]): string {
  const messages = findings
    .filter((finding) => finding.severity === "blocked")
    .map((finding) => finding.message);
  return messages.length > 0 ? messages.join("; ") : "Guardrail blocked the request.";
}

export function createBaseBlueprint(
  input: Omit<AgentBlueprint, "guardrails" | "memory" | "approval" | "observability"> &
    Partial<Pick<AgentBlueprint, "guardrails" | "memory" | "approval" | "observability">>,
): AgentBlueprint {
  return {
    ...input,
    guardrails: input.guardrails ?? defaultPublicGuardrails,
    memory: input.memory ?? { enabled: true, retention: "session" },
    approval: input.approval ?? { requireHumanForExternalActions: true },
    observability: input.observability ?? { logEvents: true, redactSensitiveData: true },
  };
}
