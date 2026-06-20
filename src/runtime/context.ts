import type { WorkflowRisk } from "./workflow-registry.js";

export type RuntimeSurface =
  | "cli"
  | "api"
  | "web"
  | "whatsapp"
  | "slack"
  | "teams"
  | "internal"
  | "mcp"
  | "worker";

export interface TenantContext {
  id: string;
  name?: string;
  environment?: "development" | "staging" | "production";
  metadata?: Record<string, unknown>;
}

export interface UserContext {
  id?: string;
  displayName?: string;
  roles?: string[];
  groups?: string[];
  metadata?: Record<string, unknown>;
}

export interface DataBoundary {
  region?: string;
  classification?: "public" | "internal" | "confidential" | "restricted";
  allowCrossTenantMemory?: boolean;
  redactSensitiveData?: boolean;
}

export interface CostBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCostUsd?: number;
  maxTurns?: number;
}

export interface RetentionPolicy {
  conversationDays?: number;
  eventDays?: number;
  artifactDays?: number;
}

export interface RuntimePolicy {
  allowedTools?: string[];
  maxToolRisk?: WorkflowRisk;
  requireHumanApprovalFor?: WorkflowRisk[];
  dataBoundary?: DataBoundary;
  costBudget?: CostBudget;
  retention?: RetentionPolicy;
  rateLimit?: {
    maxRequestsPerMinute?: number;
    maxConcurrentRuns?: number;
  };
}

export interface RuntimeRequestContext {
  tenant?: TenantContext;
  user?: UserContext;
  surface: RuntimeSurface;
  channel?: string;
  correlationId?: string;
  policy?: RuntimePolicy;
  metadata?: Record<string, unknown>;
}

export interface RuntimePolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  risk: WorkflowRisk;
}

export function createRuntimeRequestContext(
  input: Partial<RuntimeRequestContext> = {},
): RuntimeRequestContext {
  return {
    surface: input.surface ?? "api",
    tenant: input.tenant ? { ...input.tenant, metadata: { ...input.tenant.metadata } } : undefined,
    user: input.user
      ? {
          ...input.user,
          roles: [...(input.user.roles ?? [])],
          groups: [...(input.user.groups ?? [])],
          metadata: { ...input.user.metadata },
        }
      : undefined,
    channel: input.channel,
    correlationId: input.correlationId,
    policy: input.policy ? cloneRuntimePolicy(input.policy) : undefined,
    metadata: { ...input.metadata },
  };
}

export function mergeRuntimePolicy(
  base: RuntimePolicy | undefined,
  override: RuntimePolicy | undefined,
): RuntimePolicy | undefined {
  if (!base && !override) return undefined;
  return {
    ...base,
    ...override,
    allowedTools: override?.allowedTools
      ? [...override.allowedTools]
      : base?.allowedTools
        ? [...base.allowedTools]
        : undefined,
    requireHumanApprovalFor: override?.requireHumanApprovalFor
      ? [...override.requireHumanApprovalFor]
      : base?.requireHumanApprovalFor
        ? [...base.requireHumanApprovalFor]
        : undefined,
    dataBoundary: { ...base?.dataBoundary, ...override?.dataBoundary },
    costBudget: { ...base?.costBudget, ...override?.costBudget },
    retention: { ...base?.retention, ...override?.retention },
    rateLimit: { ...base?.rateLimit, ...override?.rateLimit },
  };
}

export function runtimeContextToMetadata(
  context: RuntimeRequestContext | undefined,
): Record<string, unknown> {
  if (!context) return {};
  return {
    surface: context.surface,
    channel: context.channel,
    correlationId: context.correlationId,
    tenantId: context.tenant?.id,
    tenantName: context.tenant?.name,
    userId: context.user?.id,
    userRoles: context.user?.roles,
    dataClassification: context.policy?.dataBoundary?.classification,
  };
}

export function evaluateRuntimeToolPolicy(
  policy: RuntimePolicy | undefined,
  input: {
    toolName: string;
    risk: WorkflowRisk;
    confirmed?: boolean;
  },
): RuntimePolicyDecision {
  if (policy?.allowedTools && !policy.allowedTools.includes(input.toolName)) {
    return {
      allowed: false,
      reason: `Runtime policy does not allow tool: ${input.toolName}`,
      risk: input.risk,
    };
  }

  if (policy?.maxToolRisk && riskRank(input.risk) > riskRank(policy.maxToolRisk)) {
    return {
      allowed: false,
      reason: `Runtime policy allows tools up to ${policy.maxToolRisk} risk; ${input.toolName} is ${input.risk}.`,
      risk: input.risk,
    };
  }

  if (policy?.requireHumanApprovalFor?.includes(input.risk) && input.confirmed !== true) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: `Runtime policy requires human approval for ${input.risk} tools.`,
      risk: input.risk,
    };
  }

  return { allowed: true, risk: input.risk };
}

export function evaluateRuntimeRiskPolicy(
  policy: RuntimePolicy | undefined,
  input: {
    subject: string;
    risk: WorkflowRisk;
    confirmed?: boolean;
  },
): RuntimePolicyDecision {
  if (policy?.maxToolRisk && riskRank(input.risk) > riskRank(policy.maxToolRisk)) {
    return {
      allowed: false,
      reason: `Runtime policy allows work up to ${policy.maxToolRisk} risk; ${input.subject} is ${input.risk}.`,
      risk: input.risk,
    };
  }

  if (policy?.requireHumanApprovalFor?.includes(input.risk) && input.confirmed !== true) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: `Runtime policy requires human approval for ${input.risk} work.`,
      risk: input.risk,
    };
  }

  return { allowed: true, risk: input.risk };
}

export function assertRuntimeUsageWithinPolicy(
  policy: RuntimePolicy | undefined,
  usage: { inputTokens?: number; outputTokens?: number },
): void {
  const budget = policy?.costBudget;
  if (!budget) return;
  if (budget.maxInputTokens !== undefined && (usage.inputTokens ?? 0) > budget.maxInputTokens) {
    throw new Error(
      `Runtime policy input token budget exceeded: ${usage.inputTokens ?? 0}/${budget.maxInputTokens}`,
    );
  }
  if (budget.maxOutputTokens !== undefined && (usage.outputTokens ?? 0) > budget.maxOutputTokens) {
    throw new Error(
      `Runtime policy output token budget exceeded: ${usage.outputTokens ?? 0}/${budget.maxOutputTokens}`,
    );
  }
}

function cloneRuntimePolicy(policy: RuntimePolicy): RuntimePolicy {
  return mergeRuntimePolicy(undefined, policy) ?? {};
}

function riskRank(risk: WorkflowRisk): number {
  switch (risk) {
    case "read-only":
      return 0;
    case "network":
      return 1;
    case "write":
      return 2;
    case "destructive":
      return 3;
    case "secrets-sensitive":
      return 4;
  }
}
