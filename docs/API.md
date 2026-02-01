# API Reference

Use Corbat-Coco as a library in your Node.js applications.

## Installation

```bash
npm install corbat-coco
# or
pnpm add corbat-coco
```

## Quick Start

```typescript
import {
  createOrchestrator,
  loadConfig,
  createAnthropicProvider,
} from "corbat-coco";

// Load configuration
const config = await loadConfig("/path/to/project");

// Create LLM provider
const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-sonnet-4-20250514",
});

// Create orchestrator
const orchestrator = createOrchestrator(provider, config, "/path/to/project");

// Run phases
orchestrator.on("phase:start", (phase) => {
  console.log(`Starting ${phase}...`);
});

orchestrator.on("task:complete", (task, result) => {
  console.log(`Task ${task.id} completed with score ${result.finalScore}`);
});

await orchestrator.run();
```

## Core Exports

### Configuration

```typescript
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  configExists,
  getConfigValue,
  setConfigValue,
  mergeWithDefaults,
  findConfigPath,
} from "corbat-coco";
```

#### `loadConfig(projectPath: string): Promise<CocoConfig>`

Load configuration from a project directory.

```typescript
const config = await loadConfig("/my/project");
console.log(config.quality.minScore); // 85
```

#### `saveConfig(projectPath: string, config: CocoConfig): Promise<void>`

Save configuration to a project directory.

```typescript
const config = createDefaultConfig();
config.quality.minScore = 90;
await saveConfig("/my/project", config);
```

#### `createDefaultConfig(): CocoConfig`

Create a default configuration object.

```typescript
const config = createDefaultConfig();
// {
//   project: { name: "", version: "0.1.0" },
//   provider: { type: "anthropic", model: "claude-sonnet-4-20250514", ... },
//   quality: { minScore: 85, minCoverage: 80, ... },
//   ...
// }
```

### Providers

```typescript
import {
  createAnthropicProvider,
  createMockProvider,
  getAvailableProviders,
} from "corbat-coco";
```

#### `createAnthropicProvider(options): LLMProvider`

Create an Anthropic Claude provider.

```typescript
const provider = createAnthropicProvider({
  apiKey: "sk-ant-...",
  model: "claude-sonnet-4-20250514",
  maxTokens: 16384,
  temperature: 0.7,
});

// Use the provider
const response = await provider.chat([
  { role: "user", content: "Hello!" }
]);
console.log(response.content);
```

### Orchestrator

```typescript
import { createOrchestrator, ProjectState } from "corbat-coco";
```

#### `createOrchestrator(provider, config, projectPath): Orchestrator`

Create a project orchestrator.

```typescript
const orchestrator = createOrchestrator(
  provider,
  config,
  "/path/to/project"
);

// Events
orchestrator.on("phase:start", (phase) => { ... });
orchestrator.on("phase:complete", (phase, result) => { ... });
orchestrator.on("task:start", (task) => { ... });
orchestrator.on("task:progress", (task, iteration, score) => { ... });
orchestrator.on("task:complete", (task, result) => { ... });
orchestrator.on("error", (error) => { ... });

// Run all phases
await orchestrator.run();

// Run specific phase
await orchestrator.runPhase("converge");
```

### Phase Executors

Each phase can be used independently:

```typescript
import {
  // Converge Phase
  createConvergeExecutor,
  DiscoveryEngine,
  SpecificationGenerator,
  SessionManager,

  // Orchestrate Phase
  createOrchestrateExecutor,
  ArchitectureGenerator,
  ADRGenerator,
  BacklogGenerator,

  // Complete Phase
  createCompleteExecutor,
  TaskIterator,
  CodeReviewer,

  // Output Phase
  createOutputExecutor,
  CICDGenerator,
  DockerGenerator,
  DocsGenerator,
} from "corbat-coco";
```

#### Example: Run Only Discovery

```typescript
import { createDiscoveryEngine } from "corbat-coco";

const discovery = createDiscoveryEngine(provider, {
  maxQuestionsPerRound: 5,
  maxQuestionRounds: 3,
  minRequirements: 5,
});

const specification = await discovery.discover({
  projectName: "my-app",
  initialDescription: "A REST API for tasks",
  onQuestion: async (questions) => {
    // Return answers (e.g., from user input)
    return questions.map(q => ({ questionId: q.id, answer: "..." }));
  },
});
```

#### Example: Generate Architecture

```typescript
import { createArchitectureGenerator } from "corbat-coco";

const generator = createArchitectureGenerator(provider);

const architecture = await generator.generate({
  specification,
  constraints: ["TypeScript", "Express", "PostgreSQL"],
});

console.log(architecture.components);
console.log(architecture.diagrams.c4Context);
```

### Tools

```typescript
import {
  // Tool Registry
  ToolRegistry,
  createToolRegistry,
  createFullToolRegistry,

  // File Tools
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  fileExistsTool,

  // Bash Tools
  bashExecTool,
  commandExistsTool,

  // Git Tools
  gitStatusTool,
  gitCommitTool,
  gitDiffTool,

  // Test Tools
  runTestsTool,
  getCoverageTool,

  // Quality Tools
  runLinterTool,
  analyzeComplexityTool,
} from "corbat-coco";
```

#### Example: Custom Tool Registry

```typescript
import { createToolRegistry, readFileTool, writeFileTool } from "corbat-coco";

const registry = createToolRegistry();
registry.register(readFileTool);
registry.register(writeFileTool);

// Use with provider
const tools = registry.getToolDefinitions();
const response = await provider.chatWithTools(messages, tools);
```

### Utilities

```typescript
import {
  // Files
  readTextFile,
  writeTextFile,
  fileExists,
  ensureDir,

  // Strings
  truncate,
  slugify,
  dedent,

  // Async
  retry,
  timeout,
  parallel,
  debounce,

  // Validation
  validateSchema,

  // Logging
  createLogger,
  logEvent,
} from "corbat-coco";
```

## Types

Key TypeScript types:

```typescript
import type {
  // Configuration
  CocoConfig,
  ProviderConfig,
  QualityConfig,
  PersistenceConfig,

  // Specification
  Specification,
  Requirement,

  // Architecture
  Architecture,
  Component,
  ADR,

  // Backlog
  Backlog,
  Epic,
  Story,
  Task,
  Sprint,

  // Quality
  QualityScore,
  QualityDimensions,
  CodeReviewResult,

  // Execution
  TaskExecutionResult,
  PhaseResult,

  // Provider
  LLMProvider,
  ChatMessage,
  ToolDefinition,
} from "corbat-coco";
```

## Error Handling

```typescript
import {
  CocoError,
  ConfigError,
  ProviderError,
  PhaseError,
  TaskError,
  QualityError,
  FileSystemError,
  TimeoutError,
} from "corbat-coco";

try {
  await orchestrator.run();
} catch (error) {
  if (error instanceof PhaseError) {
    console.error(`Phase ${error.phase} failed:`, error.message);
  } else if (error instanceof TaskError) {
    console.error(`Task ${error.taskId} failed:`, error.message);
  } else if (error instanceof ProviderError) {
    console.error("LLM provider error:", error.message);
  }
}
```

## Events

The orchestrator emits events throughout execution:

| Event | Payload | Description |
|-------|---------|-------------|
| `phase:start` | `phase: string` | Phase started |
| `phase:complete` | `phase: string, result: PhaseResult` | Phase completed |
| `phase:error` | `phase: string, error: Error` | Phase failed |
| `task:start` | `task: Task` | Task started |
| `task:progress` | `task: Task, iteration: number, score: number` | Quality iteration |
| `task:complete` | `task: Task, result: TaskExecutionResult` | Task completed |
| `checkpoint` | `checkpoint: Checkpoint` | Checkpoint saved |

## Complete Example

```typescript
import {
  createOrchestrator,
  loadConfig,
  createAnthropicProvider,
  CocoError,
} from "corbat-coco";

async function buildProject(projectPath: string) {
  // Setup
  const config = await loadConfig(projectPath);
  const provider = createAnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: config.provider.model,
  });

  const orchestrator = createOrchestrator(provider, config, projectPath);

  // Progress tracking
  let currentPhase = "";
  let tasksCompleted = 0;

  orchestrator.on("phase:start", (phase) => {
    currentPhase = phase;
    console.log(`\n🚀 Starting ${phase} phase...\n`);
  });

  orchestrator.on("task:progress", (task, iteration, score) => {
    console.log(`  [${task.id}] Iteration ${iteration}: ${score}/100`);
  });

  orchestrator.on("task:complete", (task, result) => {
    tasksCompleted++;
    const status = result.success ? "✓" : "✗";
    console.log(`${status} ${task.title} (${result.finalScore}/100)`);
  });

  // Run
  try {
    await orchestrator.run();
    console.log(`\n✅ Build complete! ${tasksCompleted} tasks finished.`);
  } catch (error) {
    if (error instanceof CocoError) {
      console.error(`\n❌ Build failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

buildProject("./my-project");
```

---

See also:
- [Configuration Guide](guides/CONFIGURATION.md)
- [Quick Start Guide](guides/QUICK_START.md)
- [Architecture Documentation](architecture/ARCHITECTURE.md)
