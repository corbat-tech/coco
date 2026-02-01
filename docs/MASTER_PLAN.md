# Corbat-Coco: Master Development Plan

> **Autonomous Coding Agent with Self-Review, Quality Convergence, and Production-Ready Output**

---

## Table of Contents

1. [Vision and Philosophy](#1-vision-and-philosophy)
2. [Core Principles](#2-core-principles)
3. [System Architecture](#3-system-architecture)
4. [Phase Breakdown](#4-phase-breakdown)
5. [Module Specifications](#5-module-specifications)
6. [Quality System](#6-quality-system)
7. [Persistence and Recovery](#7-persistence-and-recovery)
8. [Documentation System](#8-documentation-system)
9. [Integration Points](#9-integration-points)
10. [Development Sprints](#10-development-sprints)
11. [Technical Specifications](#11-technical-specifications)
12. [Risk Mitigation](#12-risk-mitigation)

---

## 1. Vision and Philosophy

### 1.1 What is Corbat-Coco?

Corbat-Coco is an **autonomous coding agent** that develops software from natural language specifications to production-ready deployments. It operates like a senior developer team compressed into a single intelligent system.

### 1.2 Core Philosophy

```
"Every line of code must be worthy of a senior engineer's signature."
```

**Principles:**
- **Quality over Speed**: Better to iterate 10 times than ship mediocre code
- **Documentation First**: If it's not documented, it doesn't exist
- **Test-Driven**: No feature exists without its tests
- **Resilience**: Interruptions are expected, recovery is guaranteed
- **Transparency**: Every decision is recorded and justified

### 1.3 Differentiators from Existing Tools

| Feature | Claude Code | Cursor | Corbat-Coco |
|---------|-------------|--------|-------------|
| Self-review loops | No | No | Yes, with convergence |
| Quality scoring | No | No | Multi-dimensional |
| Architecture planning | Basic | No | Full ADR system |
| Progress persistence | Session only | No | Full checkpoint |
| Production deployment | No | No | CI/CD generation |
| Best practices by stack | Generic | Generic | Stack-specific profiles |

---

## 2. Core Principles

### 2.1 The COCO Methodology

**C**onverge - **O**rchestrate - **C**omplete - **O**utput

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COCO METHODOLOGY                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ CONVERGE │ →  │ORCHESTRATE│ →  │ COMPLETE │ →  │  OUTPUT  │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
│       │               │               │               │            │
│   Understand      Plan &          Execute &       Deploy &         │
│   Requirements    Design          Iterate         Document         │
│                                                                     │
│  • Discovery      • Architecture   • Sprints       • CI/CD         │
│  • Clarification  • ADRs           • Testing       • Docs          │
│  • Specification  • Backlog        • Review        • Handoff       │
│                   • Best Practices • Improve                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Quality Gates

Every task must pass through quality gates before completion:

```
GATE 1: Syntax & Types      → Code compiles, no type errors
GATE 2: Lint & Format       → Passes all linting rules
GATE 3: Tests Pass          → All unit/integration tests green
GATE 4: Coverage Threshold  → Minimum 80% coverage
GATE 5: Complexity Check    → Cyclomatic complexity < threshold
GATE 6: Security Scan       → No known vulnerabilities
GATE 7: Documentation       → All public APIs documented
GATE 8: Architecture        → Follows defined patterns
GATE 9: Performance         → Meets defined thresholds (if applicable)
GATE 10: Senior Review      → Would a senior engineer approve this?
```

### 2.3 Convergence Algorithm

```typescript
// Pseudocode for quality convergence
async function iterateUntilExcellent(task: Task): Promise<TaskResult> {
  const MAX_ITERATIONS = 10;
  const MIN_QUALITY_SCORE = 85; // Senior-level minimum
  const CONVERGENCE_THRESHOLD = 2; // Max score delta to consider converged

  let previousScore = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const result = await executeTask(task);
    const scores = await evaluateQuality(result);
    const currentScore = scores.overall;

    // Check if quality meets senior-level standards
    if (currentScore >= MIN_QUALITY_SCORE) {
      // Check for convergence (no significant improvement possible)
      if (Math.abs(currentScore - previousScore) < CONVERGENCE_THRESHOLD) {
        return { status: 'excellent', result, scores, iterations: i + 1 };
      }
    }

    // Analyze issues and create improvement plan
    const improvements = await analyzeImprovements(result, scores);
    await applyImprovements(task, improvements);

    previousScore = currentScore;
  }

  // If max iterations reached, evaluate if acceptable
  return evaluateFinalResult(task);
}
```

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CORBAT-COCO ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         CLI INTERFACE                            │   │
│  │  coco init | coco plan | coco build | coco review | coco deploy │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────┼───────────────────────────────┐   │
│  │                         ORCHESTRATOR                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │   │
│  │  │ Session  │  │  State   │  │ Recovery │  │ Progress │        │   │
│  │  │ Manager  │  │ Machine  │  │  Engine  │  │ Reporter │        │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐             │
│  │  CONVERGE   │ ORCHESTRATE │  COMPLETE   │   OUTPUT    │             │
│  ├─────────────┼─────────────┼─────────────┼─────────────┤             │
│  │ Discovery   │ Planner     │ Executor    │ Deployer    │             │
│  │ Clarifier   │ Architect   │ Tester      │ Documenter  │             │
│  │ Specifier   │ Backlogger  │ Reviewer    │ Publisher   │             │
│  │             │ Standards   │ Improver    │             │             │
│  └─────────────┴─────────────┴─────────────┴─────────────┘             │
│                                    │                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                          TOOL LAYER                              │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │   │
│  │  │  File  │ │  Bash  │ │  Git   │ │  Test  │ │  Lint  │        │   │
│  │  │ Tools  │ │ Tools  │ │ Tools  │ │ Tools  │ │ Tools  │        │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │   │
│  │  │ GitHub │ │ Docker │ │ Bundle │ │ Deploy │ │Quality │        │   │
│  │  │ Tools  │ │ Tools  │ │ Tools  │ │ Tools  │ │ Tools  │        │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PERSISTENCE LAYER                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │   │
│  │  │   Project    │  │   Session    │  │   Version    │           │   │
│  │  │    State     │  │   Checkpoints│  │   History    │           │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        LLM PROVIDERS                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │   │
│  │  │ Anthropic│  │  OpenAI  │  │  Local   │  │  Custom  │        │   │
│  │  │ (Claude) │  │  (GPT-4) │  │ (Ollama) │  │ Provider │        │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Dependency Graph

```
                    ┌─────────────┐
                    │     CLI     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Orchestrator│
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │   Phases    │ │   State     │ │  Recovery   │
    │   Engine    │ │   Machine   │ │   Engine    │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                    ┌──────▼──────┐
                    │    Tools    │
                    │   Registry  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │    File     │ │    Bash     │ │   Quality   │
    │   Tools     │ │   Tools     │ │   Tools     │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### 3.3 Data Flow

```
User Input
    │
    ▼
┌─────────────────┐
│    CONVERGE     │ ──→ spec.md, requirements.json
│   (Discovery)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   ORCHESTRATE   │ ──→ architecture.md, ADRs, backlog.json
│   (Planning)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│    COMPLETE     │ ←──→│ Version History  │
│   (Execution)   │     │ (iterations)     │
└────────┬────────┘     └──────────────────┘
         │
         │  ┌─────────────────────────┐
         │  │   ITERATION LOOP        │
         │  │                         │
         │  │  Execute → Test →       │
         │  │  Score → Improve →      │
         │  │  (repeat until          │
         │  │   excellent)            │
         │  │                         │
         │  └─────────────────────────┘
         │
         ▼
┌─────────────────┐
│     OUTPUT      │ ──→ CI/CD, Docs, Deployment
│   (Delivery)    │
└─────────────────┘
```

---

## 4. Phase Breakdown

### 4.1 Phase 1: CONVERGE (Discovery & Specification)

**Purpose:** Transform vague user intent into precise, actionable specification.

#### 4.1.1 Discovery Engine

```typescript
interface DiscoveryEngine {
  // Gather initial requirements through conversation
  gatherRequirements(userInput: string): Promise<RequirementsSession>;

  // Ask clarifying questions iteratively
  clarify(session: RequirementsSession): Promise<Clarification[]>;

  // Validate understanding with user
  validateUnderstanding(session: RequirementsSession): Promise<boolean>;

  // Generate specification document
  generateSpecification(session: RequirementsSession): Promise<Specification>;
}
```

#### 4.1.2 Clarification Categories

```typescript
enum ClarificationCategory {
  // Functional
  FEATURE_SCOPE = "feature_scope",
  USER_STORIES = "user_stories",
  ACCEPTANCE_CRITERIA = "acceptance_criteria",
  EDGE_CASES = "edge_cases",

  // Technical
  LANGUAGE_FRAMEWORK = "language_framework",
  ARCHITECTURE_STYLE = "architecture_style",
  DATABASE_CHOICE = "database_choice",
  EXTERNAL_SERVICES = "external_services",

  // Quality
  PERFORMANCE_REQUIREMENTS = "performance_requirements",
  SECURITY_REQUIREMENTS = "security_requirements",
  SCALABILITY_NEEDS = "scalability_needs",

  // Deployment
  HOSTING_PLATFORM = "hosting_platform",
  CI_CD_REQUIREMENTS = "ci_cd_requirements",
  ENVIRONMENT_CONFIG = "environment_config",
}
```

#### 4.1.3 Output Artifacts

```
.coco/
├── discovery/
│   ├── session-001.json         # Raw conversation
│   ├── requirements.json        # Structured requirements
│   ├── clarifications.json      # Q&A log
│   └── user-stories.json        # Extracted user stories
└── spec/
    ├── SPECIFICATION.md         # Human-readable spec
    ├── functional-requirements.md
    ├── non-functional-requirements.md
    └── acceptance-criteria.md
```

---

### 4.2 Phase 2: ORCHESTRATE (Architecture & Planning)

**Purpose:** Design the system architecture and create an executable plan.

#### 4.2.1 Architecture Decision Records (ADRs)

```markdown
# ADR-001: Choice of Framework

## Status
Accepted

## Context
We need to choose a backend framework for the REST API.

## Decision
We will use NestJS with TypeScript.

## Rationale
- Strong typing with TypeScript
- Modular architecture (aligns with our hexagonal approach)
- Built-in dependency injection
- Excellent testing support
- Active community and documentation

## Alternatives Considered
1. **Express.js** - Too minimal, would need many additions
2. **Fastify** - Good performance but less structured
3. **Koa** - Similar to Express, less community support

## Consequences
- Team needs NestJS knowledge
- Slightly larger bundle size than minimal frameworks
- Easier testing and maintenance
```

#### 4.2.2 Architecture Templates

```typescript
type ArchitectureStyle =
  | "monolith"           // Single deployable unit
  | "modular-monolith"   // Monolith with clear module boundaries
  | "microservices"      // Distributed services
  | "serverless"         // Function-based
  | "hybrid";            // Mix of patterns

interface ArchitectureDecision {
  style: ArchitectureStyle;
  patterns: string[];           // e.g., ["hexagonal", "cqrs", "event-sourcing"]
  modules: ModuleDefinition[];
  integrations: IntegrationPoint[];
  deployment: DeploymentStrategy;
}
```

#### 4.2.3 Backlog Generation

```typescript
interface Backlog {
  epics: Epic[];
  currentSprint: Sprint;
  velocity: number;  // Estimated story points per sprint
}

interface Epic {
  id: string;
  title: string;
  description: string;
  stories: Story[];
  priority: 1 | 2 | 3 | 4 | 5;
  dependencies: string[];  // Epic IDs
}

interface Story {
  id: string;
  epicId: string;
  title: string;
  asA: string;        // "As a [role]"
  iWant: string;      // "I want [feature]"
  soThat: string;     // "So that [benefit]"
  acceptanceCriteria: string[];
  tasks: Task[];
  points: number;     // Story points (1, 2, 3, 5, 8, 13)
}

interface Task {
  id: string;
  storyId: string;
  title: string;
  type: "feature" | "test" | "refactor" | "docs" | "infra" | "config";
  description: string;
  files: string[];          // Expected files to create/modify
  dependencies: string[];   // Task IDs that must complete first
  estimatedComplexity: "trivial" | "simple" | "moderate" | "complex";
}
```

#### 4.2.4 Best Practices Integration

```typescript
interface StackProfile {
  id: string;
  name: string;
  language: "typescript" | "python" | "go" | "rust" | "java";
  framework?: string;

  // Patterns
  architecture: {
    recommended: string[];
    antiPatterns: string[];
  };

  // Tooling
  tooling: {
    packageManager: string;
    buildTool: string;
    testFramework: string;
    linter: string;
    formatter: string;
  };

  // Structure
  structure: {
    rootFiles: string[];          // Required root files
    directories: DirectorySpec[];
    namingConventions: NamingConvention[];
  };

  // Quality
  quality: {
    minCoverage: number;
    maxComplexity: number;
    maxFileLines: number;
    maxFunctionLines: number;
  };

  // Rules
  rules: {
    must: string[];    // Mandatory rules
    should: string[];  // Recommended rules
    avoid: string[];   // Anti-patterns
  };
}
```

#### 4.2.5 Output Artifacts

```
.coco/
├── architecture/
│   ├── ARCHITECTURE.md          # Main architecture document
│   ├── diagrams/
│   │   ├── system-context.mmd   # Mermaid diagram
│   │   ├── container.mmd
│   │   ├── component.mmd
│   │   └── data-flow.mmd
│   └── adrs/
│       ├── 001-framework.md
│       ├── 002-database.md
│       ├── 003-auth-strategy.md
│       └── template.md
├── planning/
│   ├── backlog.json
│   ├── epics/
│   │   ├── epic-001-auth.json
│   │   └── epic-002-users.json
│   ├── current-sprint.json
│   └── roadmap.md
└── standards/
    ├── stack-profile.json
    ├── coding-standards.md
    ├── testing-strategy.md
    └── git-workflow.md
```

---

### 4.3 Phase 3: COMPLETE (Execution & Iteration)

**Purpose:** Execute tasks with continuous improvement until excellence.

#### 4.3.1 Task Execution Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK EXECUTION LOOP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐                                                   │
│  │  START  │                                                   │
│  └────┬────┘                                                   │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────┐                                               │
│  │ Load Task   │                                               │
│  │ Context     │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐     ┌─────────────┐                           │
│  │  Generate   │ ──→ │   Save      │                           │
│  │  Code v{n}  │     │  Checkpoint │                           │
│  └──────┬──────┘     └─────────────┘                           │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                               │
│  │  Run Tests  │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                               │
│  │  Evaluate   │                                               │
│  │  Quality    │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────┐                           │
│  │  Score >= 85 AND Converged?     │                           │
│  └──────────────┬──────────────────┘                           │
│           │                │                                    │
│          YES              NO                                    │
│           │                │                                    │
│           ▼                ▼                                    │
│  ┌─────────────┐  ┌─────────────────┐                          │
│  │  COMPLETE   │  │ Analyze Issues  │                          │
│  │  Task       │  │ Plan Improve    │                          │
│  └─────────────┘  └────────┬────────┘                          │
│                            │                                    │
│                            ▼                                    │
│                   ┌─────────────────┐                          │
│                   │ Apply Improve   │ ──→ (back to Generate)   │
│                   │ Increment v{n}  │                          │
│                   └─────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.3.2 Version Control for Iterations

```typescript
interface TaskVersion {
  version: number;
  timestamp: Date;

  // Changes
  changes: {
    filesCreated: string[];
    filesModified: string[];
    filesDeleted: string[];
  };

  // Diffs
  diffs: {
    file: string;
    diff: string;  // Unified diff format
  }[];

  // Quality
  scores: QualityScores;
  testResults: TestResults;

  // Analysis
  analysis: {
    issuesFound: Issue[];
    improvementsApplied: Improvement[];
    reasoning: string;
  };
}

interface TaskHistory {
  taskId: string;
  versions: TaskVersion[];
  currentVersion: number;
  status: "in_progress" | "completed" | "blocked" | "rolled_back";

  // Metrics
  totalIterations: number;
  timeSpent: number;  // milliseconds
  qualityProgression: number[];  // Score per version
}
```

#### 4.3.3 Self-Review System

```typescript
interface SelfReview {
  // What the agent checks
  checks: ReviewCheck[];

  // Issues found
  issues: ReviewIssue[];

  // Proposed fixes
  fixes: ReviewFix[];

  // Confidence level
  confidence: number;  // 0-100

  // Summary
  summary: string;
}

interface ReviewCheck {
  category: ReviewCategory;
  name: string;
  passed: boolean;
  details: string;
  severity: "critical" | "major" | "minor" | "info";
}

type ReviewCategory =
  | "correctness"      // Does it do what it should?
  | "completeness"     // Are all requirements met?
  | "robustness"       // Does it handle edge cases?
  | "readability"      // Is the code clear?
  | "maintainability"  // Is it easy to modify?
  | "performance"      // Is it efficient?
  | "security"         // Is it secure?
  | "testability"      // Is it well-tested?
  | "documentation"    // Is it documented?
  | "style";           // Does it follow conventions?
```

#### 4.3.4 Output Artifacts

```
.coco/
├── execution/
│   ├── current-task.json
│   ├── sprint-progress.json
│   └── execution-log.jsonl      # Append-only log
├── versions/
│   ├── task-001/
│   │   ├── v1/
│   │   │   ├── metadata.json
│   │   │   ├── changes.diff
│   │   │   ├── scores.json
│   │   │   └── review.json
│   │   ├── v2/
│   │   │   └── ...
│   │   └── history.json
│   └── task-002/
│       └── ...
└── reviews/
    ├── task-001-final-review.md
    └── sprint-001-retrospective.md
```

---

### 4.4 Phase 4: OUTPUT (Delivery & Deployment)

**Purpose:** Prepare the project for production deployment.

#### 4.4.1 CI/CD Generation

```typescript
interface CICDConfig {
  platform: "github-actions" | "gitlab-ci" | "jenkins" | "circleci";

  stages: {
    lint: StageConfig;
    test: StageConfig;
    build: StageConfig;
    security: StageConfig;
    deploy: DeployStageConfig;
  };

  environments: {
    development: EnvironmentConfig;
    staging: EnvironmentConfig;
    production: EnvironmentConfig;
  };

  triggers: {
    push: TriggerConfig;
    pullRequest: TriggerConfig;
    schedule?: ScheduleConfig;
  };
}
```

#### 4.4.2 Documentation Generation

```typescript
interface DocumentationPlan {
  // Generated docs
  readme: ReadmeConfig;
  api: APIDocConfig;
  architecture: ArchDocConfig;
  contributing: ContributingConfig;
  changelog: ChangelogConfig;

  // Hosting
  hosting?: {
    platform: "github-pages" | "vercel" | "netlify" | "custom";
    domain?: string;
  };
}
```

#### 4.4.3 Deployment Artifacts

```typescript
interface DeploymentArtifacts {
  // Container
  dockerfile?: string;
  dockerCompose?: string;

  // Kubernetes
  k8sManifests?: {
    deployment: string;
    service: string;
    ingress: string;
    configMap: string;
    secrets: string;
  };

  // Serverless
  serverlessConfig?: string;

  // Infrastructure as Code
  terraform?: string[];
  pulumi?: string[];

  // Environment
  envExample: string;
  envDocs: string;
}
```

#### 4.4.4 Output Artifacts

```
.coco/
├── delivery/
│   ├── RELEASE_NOTES.md
│   ├── DEPLOYMENT_GUIDE.md
│   └── RUNBOOK.md
├── ci-cd/
│   ├── .github/
│   │   └── workflows/
│   │       ├── ci.yml
│   │       ├── cd.yml
│   │       └── security.yml
│   └── deployment/
│       ├── Dockerfile
│       ├── docker-compose.yml
│       └── k8s/
│           └── ...
└── docs/
    ├── README.md
    ├── CONTRIBUTING.md
    ├── CHANGELOG.md
    ├── API.md
    └── ARCHITECTURE.md
```

---

## 5. Module Specifications

### 5.1 Core Modules

```
src/
├── cli/                      # Command-line interface
│   ├── program.ts            # Main CLI setup (commander)
│   ├── commands/
│   │   ├── init.ts           # Initialize new project
│   │   ├── plan.ts           # Run discovery + planning
│   │   ├── build.ts          # Execute tasks
│   │   ├── review.ts         # Run self-review
│   │   ├── deploy.ts         # Generate deployment
│   │   ├── status.ts         # Show current status
│   │   ├── resume.ts         # Resume from checkpoint
│   │   └── config.ts         # Configuration management
│   └── ui/
│       ├── prompts.ts        # User prompts
│       ├── progress.ts       # Progress indicators
│       └── tables.ts         # Data tables
│
├── orchestrator/             # Central coordinator
│   ├── orchestrator.ts       # Main orchestration logic
│   ├── state-machine.ts      # Phase state management
│   ├── session.ts            # Session management
│   └── events.ts             # Event emitter
│
├── phases/                   # Phase implementations
│   ├── converge/
│   │   ├── discovery.ts      # Requirements gathering
│   │   ├── clarifier.ts      # Clarification engine
│   │   └── specifier.ts      # Specification generator
│   ├── orchestrate/
│   │   ├── architect.ts      # Architecture design
│   │   ├── planner.ts        # Backlog planning
│   │   ├── adr.ts            # ADR management
│   │   └── standards.ts      # Best practices
│   ├── complete/
│   │   ├── executor.ts       # Task execution
│   │   ├── tester.ts         # Test runner
│   │   ├── reviewer.ts       # Self-review
│   │   ├── improver.ts       # Improvement engine
│   │   └── versioner.ts      # Version management
│   └── output/
│       ├── deployer.ts       # Deployment generation
│       ├── documenter.ts     # Documentation
│       └── publisher.ts      # Release management
│
├── tools/                    # Tool implementations
│   ├── registry.ts           # Tool registry
│   ├── file/
│   │   ├── read.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   └── glob.ts
│   ├── bash/
│   │   ├── exec.ts
│   │   └── background.ts
│   ├── git/
│   │   ├── operations.ts
│   │   └── github.ts
│   ├── test/
│   │   ├── runner.ts
│   │   ├── coverage.ts
│   │   └── analyzer.ts
│   ├── quality/
│   │   ├── scorer.ts
│   │   ├── linter.ts
│   │   ├── complexity.ts
│   │   └── security.ts
│   └── deploy/
│       ├── docker.ts
│       ├── cicd.ts
│       └── k8s.ts
│
├── quality/                  # Quality system
│   ├── scores.ts             # Score calculation
│   ├── thresholds.ts         # Quality thresholds
│   ├── convergence.ts        # Convergence detection
│   └── metrics.ts            # Metrics collection
│
├── persistence/              # State persistence
│   ├── store.ts              # Main store
│   ├── checkpoint.ts         # Checkpointing
│   ├── recovery.ts           # Recovery engine
│   └── history.ts            # Version history
│
├── providers/                # LLM providers
│   ├── provider.ts           # Provider interface
│   ├── anthropic.ts          # Claude integration
│   ├── openai.ts             # GPT integration
│   └── local.ts              # Local models
│
├── config/                   # Configuration
│   ├── schema.ts             # Config schema (zod)
│   ├── loader.ts             # Config loading
│   ├── defaults.ts           # Default values
│   └── profiles/             # Stack profiles
│       ├── typescript.ts
│       ├── python.ts
│       ├── go.ts
│       └── rust.ts
│
├── types/                    # Type definitions
│   ├── project.ts
│   ├── task.ts
│   ├── quality.ts
│   └── config.ts
│
└── utils/                    # Utilities
    ├── logger.ts
    ├── errors.ts
    ├── validation.ts
    └── formatting.ts
```

### 5.2 Module Interfaces

```typescript
// Core orchestrator interface
interface Orchestrator {
  // Lifecycle
  initialize(projectPath: string): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;

  // Phase management
  getCurrentPhase(): Phase;
  transitionTo(phase: Phase): Promise<void>;

  // State
  getState(): ProjectState;
  getProgress(): Progress;

  // Events
  on(event: OrchestratorEvent, handler: EventHandler): void;
  off(event: OrchestratorEvent, handler: EventHandler): void;
}

// Phase interface
interface PhaseExecutor {
  name: string;
  description: string;

  // Lifecycle
  canStart(state: ProjectState): boolean;
  execute(context: PhaseContext): Promise<PhaseResult>;
  canComplete(state: ProjectState): boolean;

  // Recovery
  checkpoint(): Promise<Checkpoint>;
  restore(checkpoint: Checkpoint): Promise<void>;
}

// Tool interface
interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;

  execute(params: unknown): Promise<ToolResult>;
  validate?(params: unknown): ValidationResult;
}
```

---

## 6. Quality System

### 6.1 Quality Scores

```typescript
interface QualityScores {
  // Overall score (weighted average)
  overall: number;  // 0-100

  // Individual dimensions
  dimensions: {
    // Code quality
    correctness: number;      // Does it work correctly?
    completeness: number;     // Are all requirements met?
    robustness: number;       // Edge case handling

    // Code health
    readability: number;      // Code clarity
    maintainability: number;  // Ease of modification
    complexity: number;       // Cyclomatic complexity (inverted)
    duplication: number;      // DRY score (inverted)

    // Testing
    testCoverage: number;     // Line/branch coverage
    testQuality: number;      // Test meaningfulness

    // Security
    security: number;         // Vulnerability score

    // Documentation
    documentation: number;    // Doc coverage

    // Style
    style: number;            // Linting score
  };

  // Weights (must sum to 1.0)
  weights: {
    correctness: 0.15;
    completeness: 0.10;
    robustness: 0.10;
    readability: 0.10;
    maintainability: 0.10;
    complexity: 0.08;
    duplication: 0.07;
    testCoverage: 0.10;
    testQuality: 0.05;
    security: 0.08;
    documentation: 0.04;
    style: 0.03;
  };
}
```

### 6.2 Quality Thresholds

```typescript
interface QualityThresholds {
  // Minimum acceptable scores
  minimum: {
    overall: 85;           // Senior-level minimum
    testCoverage: 80;      // 80% coverage minimum
    security: 100;         // No known vulnerabilities
    complexity: 70;        // Reasonable complexity
  };

  // Target scores (excellent)
  target: {
    overall: 95;
    testCoverage: 90;
    security: 100;
    complexity: 85;
  };

  // Convergence threshold
  convergenceThreshold: 2;  // Max score improvement to consider converged

  // Max iterations before forced completion
  maxIterations: 10;
}
```

### 6.3 Scoring Implementation

```typescript
async function calculateQualityScores(
  taskResult: TaskResult,
  context: TaskContext
): Promise<QualityScores> {

  // Run all quality checks in parallel
  const [
    testResults,
    lintResults,
    complexityResults,
    securityResults,
    docResults,
  ] = await Promise.all([
    runTests(taskResult.files),
    runLinter(taskResult.files),
    analyzeComplexity(taskResult.files),
    scanSecurity(taskResult.files),
    analyzeDocumentation(taskResult.files),
  ]);

  // Calculate individual scores
  const dimensions = {
    correctness: calculateCorrectnessScore(testResults),
    completeness: calculateCompletenessScore(taskResult, context.task),
    robustness: calculateRobustnessScore(testResults),
    readability: calculateReadabilityScore(taskResult.files),
    maintainability: calculateMaintainabilityScore(complexityResults),
    complexity: calculateComplexityScore(complexityResults),
    duplication: calculateDuplicationScore(taskResult.files),
    testCoverage: testResults.coverage.lines,
    testQuality: calculateTestQualityScore(testResults),
    security: calculateSecurityScore(securityResults),
    documentation: docResults.coverage,
    style: lintResults.score,
  };

  // Calculate weighted overall score
  const overall = calculateWeightedScore(dimensions, WEIGHTS);

  return { overall, dimensions, weights: WEIGHTS };
}
```

---

## 7. Persistence and Recovery

### 7.1 Checkpoint System

```typescript
interface Checkpoint {
  id: string;
  timestamp: Date;

  // State snapshot
  state: {
    phase: Phase;
    currentTask: Task | null;
    completedTasks: string[];
    pendingTasks: string[];
  };

  // File state
  files: {
    path: string;
    hash: string;
    content?: string;  // For small files
  }[];

  // Execution context
  context: {
    sessionId: string;
    iterationCount: number;
    lastScores: QualityScores | null;
  };

  // Recovery info
  recovery: {
    canResume: boolean;
    resumePoint: string;
    requiredActions: string[];
  };
}
```

### 7.2 Checkpoint Strategy

```typescript
enum CheckpointTrigger {
  PHASE_TRANSITION = "phase_transition",
  TASK_START = "task_start",
  TASK_COMPLETE = "task_complete",
  ITERATION_COMPLETE = "iteration_complete",
  TIME_INTERVAL = "time_interval",      // Every 5 minutes
  USER_REQUEST = "user_request",
  ERROR_RECOVERY = "error_recovery",
}

interface CheckpointConfig {
  // When to checkpoint
  triggers: CheckpointTrigger[];

  // Time-based
  intervalMs: 300000;  // 5 minutes

  // Retention
  maxCheckpoints: 50;
  retentionDays: 7;

  // What to include
  includeFileContents: boolean;
  compressOldCheckpoints: boolean;
}
```

### 7.3 Recovery Process

```typescript
async function recoverFromInterruption(
  projectPath: string
): Promise<RecoveryResult> {

  // 1. Find latest valid checkpoint
  const checkpoint = await findLatestCheckpoint(projectPath);
  if (!checkpoint) {
    return { status: 'no_checkpoint', action: 'start_fresh' };
  }

  // 2. Validate checkpoint integrity
  const validation = await validateCheckpoint(checkpoint);
  if (!validation.valid) {
    // Try previous checkpoint
    return recoverFromPreviousCheckpoint(projectPath, checkpoint.id);
  }

  // 3. Analyze current state vs checkpoint
  const stateDiff = await analyzeStateDifference(checkpoint, projectPath);

  // 4. Determine recovery strategy
  if (stateDiff.filesModifiedSinceCheckpoint.length === 0) {
    // Clean recovery - resume exactly
    return {
      status: 'clean_recovery',
      action: 'resume',
      checkpoint,
      resumePoint: checkpoint.state.currentTask,
    };
  }

  // 5. Handle partial progress since checkpoint
  return {
    status: 'partial_recovery',
    action: 'merge_and_resume',
    checkpoint,
    modifications: stateDiff,
    suggestedApproach: determineMergeStrategy(stateDiff),
  };
}
```

### 7.4 State File Structure

```
.coco/
├── state/
│   ├── project.json           # Main project state
│   ├── session.json           # Current session
│   └── lock.json              # Concurrency lock
├── checkpoints/
│   ├── latest.json            # Pointer to latest
│   ├── cp-2024-01-15-001.json
│   ├── cp-2024-01-15-002.json
│   └── archive/               # Compressed old checkpoints
│       └── cp-2024-01-14-*.gz
└── logs/
    ├── execution.jsonl        # Append-only execution log
    ├── errors.jsonl           # Error log
    └── quality.jsonl          # Quality metrics over time
```

---

## 8. Documentation System

### 8.1 Auto-Generated Documentation

```typescript
interface DocumentationConfig {
  // What to generate
  generate: {
    readme: boolean;
    architecture: boolean;
    api: boolean;
    contributing: boolean;
    changelog: boolean;
    runbook: boolean;
  };

  // Diagram generation
  diagrams: {
    systemContext: boolean;    // C4 Level 1
    containers: boolean;       // C4 Level 2
    components: boolean;       // C4 Level 3
    dataFlow: boolean;
    erd: boolean;              // Entity relationships
    sequence: boolean;         // Key flows
  };

  // Format
  format: "markdown" | "mdx";
  diagramFormat: "mermaid" | "plantuml" | "d2";

  // Hosting
  hosting?: {
    platform: "docusaurus" | "vitepress" | "mkdocs" | "mintlify";
  };
}
```

### 8.2 Diagram Templates

```mermaid
%% System Context Diagram Template
graph TB
    subgraph Users
        U1[End User]
        U2[Admin]
    end

    subgraph "{{PROJECT_NAME}}"
        SYS[{{PROJECT_NAME}} System]
    end

    subgraph "External Systems"
        EXT1[External Service 1]
        EXT2[External Service 2]
    end

    U1 -->|Uses| SYS
    U2 -->|Manages| SYS
    SYS -->|Integrates| EXT1
    SYS -->|Sends data| EXT2
```

### 8.3 Documentation Artifacts

```
docs/
├── README.md                    # Project overview
├── ARCHITECTURE.md              # Architecture overview
├── CONTRIBUTING.md              # How to contribute
├── CHANGELOG.md                 # Version history
├── api/
│   ├── README.md
│   └── endpoints/
│       └── *.md
├── guides/
│   ├── getting-started.md
│   ├── configuration.md
│   ├── deployment.md
│   └── troubleshooting.md
├── diagrams/
│   ├── system-context.mmd
│   ├── containers.mmd
│   ├── components.mmd
│   └── data-flow.mmd
├── adrs/
│   ├── 001-*.md
│   └── template.md
└── runbook/
    ├── operations.md
    ├── monitoring.md
    └── incident-response.md
```

---

## 9. Integration Points

### 9.1 LLM Provider Interface

```typescript
interface LLMProvider {
  id: string;
  name: string;

  // Configuration
  configure(config: ProviderConfig): void;

  // Core methods
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: StreamOptions): AsyncIterable<StreamChunk>;

  // Tool use
  chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatWithToolsResponse>;

  // Token counting
  countTokens(text: string): number;
  getContextWindow(): number;

  // Health
  healthCheck(): Promise<boolean>;
}
```

### 9.2 GitHub Integration

```typescript
interface GitHubIntegration {
  // Repository
  createRepo(options: CreateRepoOptions): Promise<Repository>;
  cloneRepo(url: string, path: string): Promise<void>;

  // Branches
  createBranch(name: string, from?: string): Promise<void>;
  switchBranch(name: string): Promise<void>;

  // Commits
  commit(message: string, files?: string[]): Promise<Commit>;
  push(options?: PushOptions): Promise<void>;

  // Pull Requests
  createPR(options: CreatePROptions): Promise<PullRequest>;
  mergePR(prNumber: number, options?: MergeOptions): Promise<void>;

  // Issues
  createIssue(options: CreateIssueOptions): Promise<Issue>;
  closeIssue(issueNumber: number): Promise<void>;

  // Actions
  getWorkflowRuns(): Promise<WorkflowRun[]>;
  triggerWorkflow(workflowId: string): Promise<void>;
}
```

### 9.3 External Tool Integration

```typescript
interface ExternalToolConfig {
  // Package managers
  npm?: NpmConfig;
  pnpm?: PnpmConfig;
  yarn?: YarnConfig;
  pip?: PipConfig;
  cargo?: CargoConfig;

  // Build tools
  esbuild?: EsbuildConfig;
  webpack?: WebpackConfig;
  vite?: ViteConfig;

  // Test frameworks
  vitest?: VitestConfig;
  jest?: JestConfig;
  pytest?: PytestConfig;

  // Linters
  eslint?: EslintConfig;
  oxlint?: OxlintConfig;
  ruff?: RuffConfig;

  // Formatters
  prettier?: PrettierConfig;
  oxfmt?: OxfmtConfig;
  black?: BlackConfig;

  // Security
  snyk?: SnykConfig;
  dependabot?: DependabotConfig;

  // Deployment
  docker?: DockerConfig;
  kubernetes?: K8sConfig;
}
```

---

## 10. Development Sprints

### Sprint 0: Foundation (Week 1)
**Goal:** Project setup and core infrastructure

```
Tasks:
├── [ ] Initialize repository with proper structure
├── [ ] Set up TypeScript with strict mode
├── [ ] Configure build system (tsup/esbuild)
├── [ ] Set up testing (vitest)
├── [ ] Configure linting (oxlint) and formatting (oxfmt)
├── [ ] Create basic CLI skeleton (commander)
├── [ ] Implement configuration system (zod)
├── [ ] Set up logging (tslog)
├── [ ] Create error handling framework
└── [ ] Write initial tests

Deliverables:
├── Working CLI that responds to `coco --help`
├── Configuration loading from `.coco/config.json`
├── Logging to console and file
└── 80% test coverage on core modules
```

### Sprint 1: Tool Layer (Week 2)
**Goal:** Implement core tools

```
Tasks:
├── [ ] Tool registry with validation
├── [ ] File tools (read, write, edit, glob)
├── [ ] Bash tools (exec, background)
├── [ ] Git tools (status, commit, push)
├── [ ] Test runner integration
├── [ ] Linter integration
├── [ ] Security scanner integration
└── [ ] Quality scorer (basic)

Deliverables:
├── All tools functional with tests
├── Tool validation with zod schemas
└── Integration tests for tool combinations
```

### Sprint 2: LLM Integration (Week 3)
**Goal:** Connect to AI providers

```
Tasks:
├── [ ] Provider abstraction layer
├── [ ] Anthropic Claude integration
├── [ ] OpenAI integration (optional)
├── [ ] Local model support (Ollama)
├── [ ] Tool use implementation
├── [ ] Streaming support
├── [ ] Token counting and context management
└── [ ] Retry and failover logic

Deliverables:
├── Working chat with Claude
├── Tool use functional
├── Streaming responses
└── Provider switching
```

### Sprint 3: CONVERGE Phase (Week 4)
**Goal:** Discovery and specification

```
Tasks:
├── [ ] Discovery engine
├── [ ] Clarification system
├── [ ] Requirement extraction
├── [ ] User story generation
├── [ ] Specification document generator
├── [ ] Interactive prompts
└── [ ] Session persistence

Deliverables:
├── `coco init` creates project with questions
├── Generated spec.md from conversation
├── Requirements.json structured output
└── Session can be resumed
```

### Sprint 4: ORCHESTRATE Phase (Week 5)
**Goal:** Architecture and planning

```
Tasks:
├── [ ] Architecture decision engine
├── [ ] ADR generator
├── [ ] Stack profile system
├── [ ] Best practices integration
├── [ ] Backlog generator
├── [ ] Epic/Story/Task hierarchy
├── [ ] Dependency resolution
└── [ ] Sprint planning

Deliverables:
├── `coco plan` generates architecture
├── ADRs auto-generated
├── backlog.json with prioritized tasks
└── Stack-specific best practices applied
```

### Sprint 5: COMPLETE Phase - Core (Week 6)
**Goal:** Basic task execution

```
Tasks:
├── [ ] Task executor
├── [ ] Code generation pipeline
├── [ ] Test generation
├── [ ] Basic quality scoring
├── [ ] Version tracking
├── [ ] Checkpoint system
└── [ ] Recovery system

Deliverables:
├── `coco build` executes tasks
├── Code generated with tests
├── Checkpoints saved
├── Recovery from interruption works
```

### Sprint 6: COMPLETE Phase - Iteration (Week 7)
**Goal:** Self-review and improvement loops

```
Tasks:
├── [ ] Self-review engine
├── [ ] Issue analysis
├── [ ] Improvement planner
├── [ ] Iteration loop
├── [ ] Convergence detection
├── [ ] Quality threshold enforcement
├── [ ] Version history
└── [ ] Rollback capability

Deliverables:
├── Code iterates until excellent
├── Quality scores tracked per version
├── Convergence detection works
├── Rollback functional
```

### Sprint 7: OUTPUT Phase (Week 8)
**Goal:** Deployment and documentation

```
Tasks:
├── [ ] CI/CD generator (GitHub Actions)
├── [ ] Dockerfile generator
├── [ ] Documentation generator
├── [ ] README generator
├── [ ] Diagram generator (Mermaid)
├── [ ] Changelog management
└── [ ] Release notes

Deliverables:
├── `coco deploy` generates CI/CD
├── Full documentation generated
├── Diagrams auto-created
└── Ready for production
```

### Sprint 8: Polish & Testing (Week 9)
**Goal:** Comprehensive testing and refinement

```
Tasks:
├── [ ] E2E test suite
├── [ ] Performance optimization
├── [ ] Error handling improvement
├── [ ] UX refinement
├── [ ] Edge case handling
├── [ ] Documentation polish
└── [ ] Example projects

Deliverables:
├── Full E2E test coverage
├── Performance benchmarks
├── Complete documentation
└── Example projects working
```

### Sprint 9: Desktop Apps (Week 10) - Optional
**Goal:** GUI applications

```
Tasks:
├── [ ] Electron app setup
├── [ ] Cross-platform build
├── [ ] Real-time progress UI
├── [ ] Settings panel
├── [ ] Project browser
└── [ ] Log viewer

Deliverables:
├── macOS app
├── Windows app
├── Linux app
└── Auto-updates
```

---

## 11. Technical Specifications

### 11.1 Technology Stack

```yaml
Runtime:
  node: ">=22.0.0"
  typescript: "^5.4.0"

Build:
  bundler: "tsup" # or esbuild
  test: "vitest"
  lint: "oxlint"
  format: "oxfmt"

Dependencies:
  cli:
    - commander: "^12.0.0"      # CLI framework
    - @clack/prompts: "^0.7.0"  # Interactive prompts
    - chalk: "^5.3.0"           # Terminal colors
    - ora: "^8.0.0"             # Spinners

  config:
    - zod: "^3.22.0"            # Schema validation
    - json5: "^2.2.0"           # Config parsing

  llm:
    - "@anthropic-ai/sdk"       # Claude API
    - "openai"                  # OpenAI API (optional)

  tools:
    - glob: "^10.0.0"           # File matching
    - execa: "^8.0.0"           # Process execution
    - simple-git: "^3.22.0"     # Git operations

  quality:
    - c8: "^9.0.0"              # Coverage
    - madge: "^6.1.0"           # Dependency analysis

  persistence:
    - better-sqlite3: "^9.4.0"  # Local storage (optional)

  logging:
    - tslog: "^4.9.0"           # Structured logging
```

### 11.2 Configuration Schema

```typescript
// .coco/config.json schema
const ConfigSchema = z.object({
  // Project info
  project: z.object({
    name: z.string(),
    version: z.string().default("0.1.0"),
    description: z.string().optional(),
  }),

  // LLM provider
  provider: z.object({
    type: z.enum(["anthropic", "openai", "local"]).default("anthropic"),
    model: z.string().default("claude-sonnet-4-20250514"),
    apiKey: z.string().optional(),  // Or from env
    maxTokens: z.number().default(8192),
  }),

  // Quality settings
  quality: z.object({
    minScore: z.number().min(0).max(100).default(85),
    minCoverage: z.number().min(0).max(100).default(80),
    maxIterations: z.number().min(1).max(20).default(10),
    convergenceThreshold: z.number().default(2),
  }),

  // Stack profile
  stack: z.object({
    language: z.enum(["typescript", "python", "go", "rust"]),
    framework: z.string().optional(),
    profile: z.string().optional(),  // Custom profile path
  }),

  // Persistence
  persistence: z.object({
    checkpointInterval: z.number().default(300000),  // 5 min
    maxCheckpoints: z.number().default(50),
  }),

  // Integrations
  integrations: z.object({
    github: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
    }).optional(),
  }),
});
```

### 11.3 Directory Structure

```
corbat-coco/
├── src/
│   ├── cli/
│   ├── orchestrator/
│   ├── phases/
│   ├── tools/
│   ├── quality/
│   ├── persistence/
│   ├── providers/
│   ├── config/
│   ├── types/
│   └── utils/
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── CONTRIBUTING.md
│   └── api/
├── examples/
│   ├── simple-api/
│   └── full-stack-app/
├── scripts/
│   ├── build.ts
│   └── release.ts
├── .coco/
│   └── templates/          # Built-in templates
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 12. Risk Mitigation

### 12.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LLM context overflow | High | Medium | Summarization, chunking, context pruning |
| Infinite iteration loops | High | Low | Max iterations, convergence detection |
| File corruption on crash | High | Low | Atomic writes, checkpoints, backups |
| API rate limits | Medium | Medium | Retry with backoff, queue management |
| Large codebase handling | Medium | Medium | Incremental processing, caching |
| Quality score gaming | Medium | Low | Multiple independent metrics |

### 12.2 Mitigation Strategies

```typescript
// Context overflow mitigation
interface ContextManager {
  // Track token usage
  currentTokens: number;
  maxTokens: number;

  // Strategies
  summarizeOldMessages(): Promise<void>;
  pruneContext(strategy: PruneStrategy): void;
  splitIntoChunks(content: string): string[];

  // Alerts
  onContextWarning(threshold: number, callback: () => void): void;
}

// Infinite loop prevention
interface IterationGuard {
  maxIterations: number;
  currentIteration: number;

  // Detection
  detectOscillation(scores: number[]): boolean;
  detectNoProgress(versions: TaskVersion[]): boolean;

  // Actions
  forceComplete(reason: string): void;
  escalateToUser(issue: string): Promise<UserDecision>;
}
```

### 12.3 Recovery Procedures

```typescript
// Recovery from various failure modes
async function handleFailure(error: Error, context: ExecutionContext): Promise<RecoveryAction> {

  if (error instanceof NetworkError) {
    // Retry with exponential backoff
    return { action: 'retry', delay: calculateBackoff(context.retryCount) };
  }

  if (error instanceof ContextOverflowError) {
    // Summarize and continue
    await context.summarizeHistory();
    return { action: 'continue' };
  }

  if (error instanceof FileSystemError) {
    // Restore from checkpoint
    await restoreFromCheckpoint(context.lastCheckpoint);
    return { action: 'resume' };
  }

  if (error instanceof QualityThresholdError) {
    // Escalate to user
    const decision = await askUser('Quality threshold not met after max iterations');
    return { action: decision === 'continue' ? 'force_complete' : 'abort' };
  }

  // Unknown error - log and escalate
  await logError(error, context);
  return { action: 'escalate', reason: error.message };
}
```

---

## Appendix A: CLI Commands Reference

```bash
# Initialize a new project
coco init [path] [--template <template>]

# Run discovery and planning
coco plan [--interactive] [--skip-discovery]

# Execute the build
coco build [--task <task-id>] [--sprint <sprint-id>]

# Run self-review on current code
coco review [--file <path>] [--fix]

# Generate deployment artifacts
coco deploy [--platform <platform>]

# Show current status
coco status [--detailed] [--json]

# Resume from last checkpoint
coco resume [--checkpoint <id>]

# Configuration management
coco config get <key>
coco config set <key> <value>
coco config list

# Version history
coco history [--task <task-id>]
coco rollback <version>

# Quality metrics
coco quality [--file <path>] [--report]
```

---

## Appendix B: Example Session

```
$ coco init my-project

🚀 Welcome to Corbat-Coco!

Let's create something amazing together.

? What would you like to build?
> A REST API for managing a todo list with user authentication

? Tell me more about the features you need:
> Users can register and login
> Each user has their own todos
> Todos have title, description, due date, priority
> Users can share todos with other users

? What tech stack do you prefer?
> TypeScript with NestJS and PostgreSQL

? Any specific requirements for deployment?
> Docker containers, deployed to AWS ECS

📋 Let me summarize what I understood:

Project: Todo List API
- User authentication (register, login)
- CRUD operations for todos
- Todo sharing between users
- Stack: NestJS + TypeScript + PostgreSQL
- Deployment: Docker → AWS ECS

? Does this look correct? [Y/n]
> Y

📐 Generating architecture...

Created ADRs:
  ✓ ADR-001: NestJS as backend framework
  ✓ ADR-002: PostgreSQL for persistence
  ✓ ADR-003: JWT for authentication
  ✓ ADR-004: Hexagonal architecture pattern

📝 Generated backlog with 4 epics, 12 stories, 47 tasks

? Ready to start building? [Y/n]
> Y

🔨 Starting Sprint 1: Authentication System

Task 1/8: Create user entity and migrations
  ├─ Generating code... ████████████████████ 100%
  ├─ Running tests...
  │  └─ 12 tests passed
  ├─ Quality score: 78/100
  ├─ Analyzing improvements...
  ├─ Iteration 2:
  │  ├─ Added input validation
  │  ├─ Improved error messages
  │  └─ Quality score: 89/100
  └─ ✓ Complete (2 iterations)

Task 2/8: Implement registration endpoint
  ...

📊 Sprint 1 Complete!
  - 8/8 tasks completed
  - Average quality: 91/100
  - Test coverage: 94%
  - 0 security issues

Continue to Sprint 2? [Y/n]
```

---

## Appendix C: Quality Report Example

```markdown
# Quality Report: Task-001 (User Entity)

## Summary
- **Status:** Excellent
- **Overall Score:** 91/100
- **Iterations:** 2
- **Final Version:** v2

## Scores by Dimension

| Dimension        | Score | Target | Status |
|------------------|-------|--------|--------|
| Correctness      | 95    | 90     | ✅     |
| Completeness     | 90    | 85     | ✅     |
| Robustness       | 88    | 80     | ✅     |
| Readability      | 92    | 85     | ✅     |
| Maintainability  | 90    | 85     | ✅     |
| Complexity       | 85    | 70     | ✅     |
| Duplication      | 95    | 80     | ✅     |
| Test Coverage    | 94    | 80     | ✅     |
| Test Quality     | 88    | 75     | ✅     |
| Security         | 100   | 100    | ✅     |
| Documentation    | 82    | 70     | ✅     |
| Style            | 98    | 90     | ✅     |

## Version History

### v1 (Score: 78)
- Initial implementation
- Issues:
  - Missing input validation
  - Generic error messages
  - Low test coverage (65%)

### v2 (Score: 91) ✓ Final
- Added class-validator decorators
- Specific error messages per field
- Added edge case tests
- Coverage: 94%

## Files Created
- `src/users/entities/user.entity.ts`
- `src/users/dto/create-user.dto.ts`
- `src/users/dto/update-user.dto.ts`
- `src/users/users.service.ts`
- `src/users/users.service.spec.ts`
- `src/database/migrations/001-create-users.ts`
```

---

**Document Version:** 1.0.0
**Created:** 2024-01-15
**Last Updated:** 2024-01-15
**Author:** Corbat-Coco Planning Agent
