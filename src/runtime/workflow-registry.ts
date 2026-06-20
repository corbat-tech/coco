import type { EventLog } from "./types.js";
import type { AgentGraphDefinition, AgentGraphNode, AgentGateDefinition } from "./multi-agent.js";
import { validateAgentGraph } from "./multi-agent.js";

export type WorkflowRisk = "read-only" | "write" | "network" | "destructive" | "secrets-sensitive";

export interface WorkflowStepDefinition {
  id: string;
  description: string;
  requiredTools: string[];
  risk: WorkflowRisk;
}

export interface WorkflowRetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  /** Legacy linear workflow steps. Prefer nodes for new multi-agent workflows. */
  steps: WorkflowStepDefinition[];
  nodes?: AgentGraphNode[];
  edges?: AgentGraphDefinition["edges"];
  gates?: AgentGateDefinition[];
  retryPolicy?: WorkflowRetryPolicy;
  parallelism?: number;
  checks: string[];
  outputKind: "markdown" | "json" | "patch" | "pull-request" | "release";
  replayable: boolean;
}

export interface WorkflowPlan {
  id: string;
  workflowId: string;
  input: Record<string, unknown>;
  status: "planned";
  createdAt: string;
}

function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    checks: [...workflow.checks],
    steps: workflow.steps.map((step) => ({
      ...step,
      requiredTools: [...step.requiredTools],
    })),
    nodes: workflow.nodes?.map((node) => ({
      ...node,
      dependsOn: node.dependsOn ? [...node.dependsOn] : undefined,
      requiredTools: node.requiredTools ? [...node.requiredTools] : undefined,
      gates: node.gates ? [...node.gates] : undefined,
      retryPolicy: node.retryPolicy ? { ...node.retryPolicy } : undefined,
    })),
    edges: workflow.edges?.map((edge) => ({ ...edge })),
    gates: workflow.gates?.map((gate) => ({ ...gate })),
    retryPolicy: workflow.retryPolicy ? { ...workflow.retryPolicy } : undefined,
  };
}

export function workflowToAgentGraph(workflow: WorkflowDefinition): AgentGraphDefinition {
  const nodes =
    workflow.nodes ??
    workflow.steps.map((step, index) => ({
      id: step.id,
      description: step.description,
      requiredTools: [...step.requiredTools],
      risk: step.risk,
      dependsOn: index > 0 ? [workflow.steps[index - 1]!.id] : [],
    }));

  return {
    nodes,
    edges: workflow.edges,
    gates: workflow.gates,
    parallelism: workflow.parallelism,
  };
}

/** Descriptive catalog of reusable workflow definitions; it does not execute workflows. */
export class WorkflowCatalog {
  private workflows = new Map<string, WorkflowDefinition>();

  constructor(workflows: WorkflowDefinition[] = DEFAULT_WORKFLOWS) {
    for (const workflow of workflows) {
      this.register(workflow);
    }
  }

  register(workflow: WorkflowDefinition): void {
    const validation = validateAgentGraph(workflowToAgentGraph(workflow));
    if (!validation.valid) {
      throw new Error(
        `Invalid workflow graph for '${workflow.id}': ${validation.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
    this.workflows.set(workflow.id, cloneWorkflow(workflow));
  }

  get(id: string): WorkflowDefinition | undefined {
    const workflow = this.workflows.get(id);
    return workflow ? cloneWorkflow(workflow) : undefined;
  }

  list(): WorkflowDefinition[] {
    return [...this.workflows.values()].map(cloneWorkflow).sort((a, b) => a.id.localeCompare(b.id));
  }

  createPlan(
    workflowId: string,
    input: Record<string, unknown>,
    eventLog?: EventLog,
  ): WorkflowPlan {
    const workflow = this.get(workflowId);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }

    const plan: WorkflowPlan = {
      id: `${workflowId}-${Date.now().toString(36)}`,
      workflowId,
      input,
      status: "planned",
      createdAt: new Date().toISOString(),
    };

    eventLog?.record("workflow.planned", {
      workflowId,
      planId: plan.id,
      replayable: workflow.replayable,
      checks: workflow.checks,
      graphLevels: validateAgentGraph(workflowToAgentGraph(workflow)).levels,
    });

    return plan;
  }
}

export const DEFAULT_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "enterprise-rag-answer",
    name: "Enterprise RAG Answer",
    description:
      "Retrieve tenant-scoped knowledge, draft a cited answer, and review for policy compliance.",
    inputSchema: "question: string; tenantId: string; userId?: string",
    outputKind: "json",
    replayable: true,
    checks: ["retrieval citations", "policy review", "answer quality"],
    steps: [],
    parallelism: 2,
    gates: [
      {
        id: "quality",
        kind: "quality-score",
        description: "Answer meets tenant quality and citation requirements.",
        required: true,
      },
    ],
    nodes: [
      {
        id: "retrieve",
        agentRole: "researcher",
        description: "Retrieve tenant-scoped sources and produce citations.",
        requiredTools: ["knowledge_search"],
        risk: "read-only",
        timeoutMs: 30_000,
      },
      {
        id: "draft-answer",
        agentRole: "docs",
        description: "Draft a concise answer grounded only in retrieved sources.",
        dependsOn: ["retrieve"],
        risk: "read-only",
        timeoutMs: 30_000,
      },
      {
        id: "policy-review",
        agentRole: "reviewer",
        description: "Review citations, data boundary, and unsupported claims.",
        dependsOn: ["draft-answer"],
        gates: ["quality"],
        risk: "read-only",
        timeoutMs: 30_000,
      },
    ],
  },
  {
    id: "whatsapp-support-assistant",
    name: "WhatsApp Support Assistant",
    description:
      "Handle a WhatsApp customer message with retrieval, support draft, and optional escalation.",
    inputSchema: "message: string; phoneNumber: string; tenantId: string",
    outputKind: "json",
    replayable: true,
    checks: ["retrieval citations", "support policy", "human escalation when needed"],
    steps: [],
    parallelism: 2,
    gates: [
      {
        id: "human-escalation",
        kind: "human-approval",
        description: "Human review is required before sensitive or external follow-up.",
        required: false,
      },
    ],
    nodes: [
      {
        id: "classify-message",
        agentRole: "planner",
        description: "Classify intent, urgency, and required data boundary.",
        risk: "read-only",
        timeoutMs: 15_000,
      },
      {
        id: "retrieve-context",
        agentRole: "researcher",
        description: "Retrieve tenant support knowledge relevant to the customer message.",
        dependsOn: ["classify-message"],
        requiredTools: ["knowledge_search"],
        risk: "read-only",
        timeoutMs: 30_000,
      },
      {
        id: "draft-response",
        agentRole: "docs",
        description: "Draft a WhatsApp-safe response with concise citations for audit.",
        dependsOn: ["retrieve-context"],
        requiredTools: ["create_support_draft"],
        risk: "read-only",
        timeoutMs: 30_000,
      },
      {
        id: "escalate-if-needed",
        agentRole: "integrator",
        description: "Create a human escalation request when classification requires it.",
        dependsOn: ["draft-response"],
        requiredTools: ["request_human_escalation"],
        gates: ["human-escalation"],
        condition: "input.requiresEscalation",
        risk: "network",
        timeoutMs: 30_000,
      },
    ],
  },
  {
    id: "architect-editor-verifier",
    name: "Architect / Editor / Verifier",
    description: "Plan read-only, apply approved changes, then verify and summarize risks.",
    inputSchema: "task: string; approvedPlan?: string",
    outputKind: "patch",
    replayable: true,
    checks: ["pnpm check", "diff summary", "review risks"],
    steps: [
      {
        id: "architect",
        description: "Inspect context and produce a read-only implementation plan.",
        requiredTools: ["repo_context", "read_file", "git_diff"],
        risk: "read-only",
      },
      {
        id: "editor",
        description: "Apply the approved plan without reinterpreting the objective.",
        requiredTools: ["read_file", "edit_file", "write_file"],
        risk: "write",
      },
      {
        id: "verifier",
        description: "Run checks, review diff, and report residual risk.",
        requiredTools: ["bash_exec", "git_diff", "review_code"],
        risk: "destructive",
      },
    ],
  },
  {
    id: "provider-diagnosis",
    name: "Provider Diagnosis",
    description:
      "Probe provider/model capabilities, endpoint strategy, credentials, and fallbacks.",
    inputSchema: "provider?: string; model?: string; live?: boolean",
    outputKind: "json",
    replayable: true,
    checks: ["provider capability matrix", "optional live probe"],
    steps: [
      {
        id: "capability",
        description: "Resolve catalog metadata and runtime endpoint strategy.",
        requiredTools: [],
        risk: "read-only",
      },
      {
        id: "fallbacks",
        description: "Suggest fallback provider/model choices when unsupported.",
        requiredTools: [],
        risk: "read-only",
      },
    ],
  },
  {
    id: "review-pr",
    name: "Review PR",
    description: "Review a branch or PR read-only and emit severity-ranked findings.",
    inputSchema: "target: string",
    outputKind: "markdown",
    replayable: true,
    checks: ["git diff", "tests gap review", "security review"],
    steps: [
      {
        id: "collect-diff",
        description: "Collect PR diff and related context.",
        requiredTools: ["git_diff", "repo_context"],
        risk: "read-only",
      },
      {
        id: "findings",
        description: "Produce prioritized findings with file and line references.",
        requiredTools: ["read_file", "review_code"],
        risk: "read-only",
      },
    ],
  },
  {
    id: "best-of-n",
    name: "Best Of N",
    description: "Run multiple isolated attempts, score them, and select a winning patch.",
    inputSchema: "task: string; attempts: number",
    outputKind: "patch",
    replayable: true,
    checks: ["worktree isolation", "checks pass", "diff risk score"],
    steps: [
      {
        id: "fanout",
        description: "Create isolated attempts in temporary worktrees.",
        requiredTools: ["git_status", "bash_exec"],
        risk: "destructive",
      },
      {
        id: "score",
        description: "Run checks and compare quality, cost, latency, and diff risk.",
        requiredTools: ["bash_exec", "git_diff"],
        risk: "destructive",
      },
      {
        id: "apply-winner",
        description: "Apply the winning patch only if conservative checks pass.",
        requiredTools: ["git_diff", "edit_file"],
        risk: "write",
      },
    ],
  },
  {
    id: "release",
    name: "Release",
    description:
      "Follow the project release skill: changelog, version bump, PR, merge, tag, publish verify.",
    inputSchema: "bump?: patch|minor|major",
    outputKind: "release",
    replayable: true,
    checks: ["pnpm check", "PR checks", "release.yml", "npm view"],
    steps: [
      {
        id: "preflight",
        description: "Verify branch, clean tree, GitHub auth, and remote state.",
        requiredTools: ["git_status", "bash_exec"],
        risk: "destructive",
      },
      {
        id: "version",
        description: "Update changelog and package versions using the release skill.",
        requiredTools: ["read_file", "edit_file", "bash_exec"],
        risk: "destructive",
      },
      {
        id: "publish",
        description: "Merge release PR, tag main, and verify release workflow outputs.",
        requiredTools: ["bash_exec"],
        risk: "destructive",
      },
    ],
  },
];

export const WorkflowRegistry = WorkflowCatalog;

export function createWorkflowCatalog(workflows?: WorkflowDefinition[]): WorkflowCatalog {
  return new WorkflowCatalog(workflows);
}

export function createWorkflowRegistry(workflows?: WorkflowDefinition[]): WorkflowCatalog {
  return createWorkflowCatalog(workflows);
}
