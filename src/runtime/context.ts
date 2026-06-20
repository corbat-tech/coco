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

function cloneRuntimePolicy(policy: RuntimePolicy): RuntimePolicy {
  return mergeRuntimePolicy(undefined, policy) ?? {};
}
