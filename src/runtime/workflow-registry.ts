import type { EventLog } from "./types.js";

export type WorkflowRisk = "read-only" | "write" | "network" | "destructive" | "secrets-sensitive";

export interface WorkflowStepDefinition {
  id: string;
  description: string;
  requiredTools: string[];
  risk: WorkflowRisk;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: string;
  steps: WorkflowStepDefinition[];
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
    });

    return plan;
  }
}

export const DEFAULT_WORKFLOWS: WorkflowDefinition[] = [
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
