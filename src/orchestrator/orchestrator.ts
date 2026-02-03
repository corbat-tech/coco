import type { Phase, PhaseResult, PhaseContext, PhaseExecutor } from "../phases/types.js";
import type {
  Orchestrator,
  OrchestratorConfig,
  OrchestratorEvents,
  Progress,
  ProjectState,
} from "./types.js";
import { createConvergeExecutor } from "../phases/converge/executor.js";
import { createOrchestrateExecutor } from "../phases/orchestrate/executor.js";
import { createCompleteExecutor } from "../phases/complete/executor.js";
import { createOutputExecutor } from "../phases/output/executor.js";
import { createProvider } from "../providers/index.js";

/**
 * Create a new orchestrator instance
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  // Internal state
  let state: ProjectState = createInitialState(config);
  const listeners = new Map<keyof OrchestratorEvents, Set<OrchestratorEvents[keyof OrchestratorEvents]>>();

  // Event emitter
  function emit<K extends keyof OrchestratorEvents>(
    event: K,
    ...args: Parameters<OrchestratorEvents[K]>
  ): void {
    const handlers = listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          // @ts-expect-error - TypeScript can't infer the correct handler type
          handler(...args);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      }
    }
  }

  // Orchestrator implementation
  const orchestrator: Orchestrator = {
    async initialize(projectPath: string): Promise<void> {
      state.path = projectPath;
      state.updatedAt = new Date();

      // Load existing state if available
      const existingState = await loadExistingState(projectPath);
      if (existingState) {
        state = existingState;
      }
    },

    async start(): Promise<void> {
      if (state.currentPhase === "idle") {
        await orchestrator.transitionTo("converge");
      }
    },

    async pause(): Promise<void> {
      // Save current state
      await saveState(state);
    },

    async resume(): Promise<void> {
      // Resume from current phase
      if (state.currentPhase !== "idle") {
        emit("phase:start", state.currentPhase);
      }
    },

    async stop(): Promise<void> {
      await saveState(state);
    },

    getCurrentPhase(): Phase {
      return state.currentPhase;
    },

    async transitionTo(phase: Phase): Promise<PhaseResult> {
      const previousPhase = state.currentPhase;

      // Record transition
      state.phaseHistory.push({
        from: previousPhase,
        to: phase,
        timestamp: new Date(),
        reason: "manual_transition",
      });

      state.currentPhase = phase;
      state.updatedAt = new Date();

      emit("phase:start", phase);

      // Execute phase
      const result = await executePhase(phase, state, config);

      emit("phase:complete", phase, result);

      return result;
    },

    getState(): ProjectState {
      return { ...state };
    },

    getProgress(): Progress {
      return calculateProgress(state);
    },

    on<K extends keyof OrchestratorEvents>(event: K, handler: OrchestratorEvents[K]): void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    },

    off<K extends keyof OrchestratorEvents>(event: K, handler: OrchestratorEvents[K]): void {
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    },
  };

  return orchestrator;
}

/**
 * Create initial project state
 */
function createInitialState(config: OrchestratorConfig): ProjectState {
  return {
    id: generateId(),
    name: "",
    path: config.projectPath,
    createdAt: new Date(),
    updatedAt: new Date(),
    currentPhase: "idle",
    phaseHistory: [],
    currentTask: null,
    completedTasks: [],
    pendingTasks: [],
    lastScores: null,
    qualityHistory: [],
    lastCheckpoint: null,
  };
}

/**
 * Load existing state from disk
 */
async function loadExistingState(projectPath: string): Promise<ProjectState | null> {
  try {
    const fs = await import("node:fs/promises");
    const statePath = `${projectPath}/.coco/state/project.json`;
    const content = await fs.readFile(statePath, "utf-8");
    const data = JSON.parse(content) as ProjectState;

    // Convert date strings back to Date objects
    data.createdAt = new Date(data.createdAt);
    data.updatedAt = new Date(data.updatedAt);

    return data;
  } catch {
    return null;
  }
}

/**
 * Save state to disk
 */
async function saveState(state: ProjectState): Promise<void> {
  const fs = await import("node:fs/promises");
  const statePath = `${state.path}/.coco/state`;

  await fs.mkdir(statePath, { recursive: true });
  await fs.writeFile(
    `${statePath}/project.json`,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

/**
 * Get executor for a phase
 */
function getPhaseExecutor(phase: Phase): PhaseExecutor | null {
  switch (phase) {
    case "converge":
      return createConvergeExecutor();
    case "orchestrate":
      return createOrchestrateExecutor();
    case "complete":
      return createCompleteExecutor();
    case "output":
      return createOutputExecutor();
    default:
      return null;
  }
}

/**
 * Create a phase context from orchestrator config
 */
async function createPhaseContext(
  config: OrchestratorConfig,
  state: ProjectState
): Promise<PhaseContext> {
  // Create LLM provider
  const provider = await createProvider(config.provider.type, {
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    maxTokens: config.provider.maxTokens,
  });

  // Create LLM interface that adapts the provider
  const llm: PhaseContext["llm"] = {
    async chat(messages) {
      const adapted = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const response = await provider.chat(adapted);
      return {
        content: response.content,
        usage: response.usage,
      };
    },
    async chatWithTools(messages, tools) {
      const adaptedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const adaptedTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as { type: "object"; properties: Record<string, unknown>; required?: string[] },
      }));
      const response = await provider.chatWithTools(adaptedMessages, { tools: adaptedTools });
      return {
        content: response.content,
        usage: response.usage,
        toolCalls: response.toolCalls?.map((tc: { name: string; input: Record<string, unknown> }) => ({
          name: tc.name,
          arguments: tc.input,
        })),
      };
    },
  };

  // Create minimal tool implementations
  const tools: PhaseContext["tools"] = {
    file: {
      async read(path: string): Promise<string> {
        const fs = await import("node:fs/promises");
        return fs.readFile(path, "utf-8");
      },
      async write(path: string, content: string): Promise<void> {
        const fs = await import("node:fs/promises");
        const nodePath = await import("node:path");
        await fs.mkdir(nodePath.dirname(path), { recursive: true });
        await fs.writeFile(path, content, "utf-8");
      },
      async exists(path: string): Promise<boolean> {
        const fs = await import("node:fs/promises");
        try {
          await fs.access(path);
          return true;
        } catch {
          return false;
        }
      },
      async glob(pattern: string): Promise<string[]> {
        // Simplified glob implementation
        const { glob } = await import("glob");
        return glob(pattern, { cwd: state.path });
      },
    },
    bash: {
      async exec(command: string, options = {}) {
        const { execa } = await import("execa");
        try {
          const result = await execa(command, {
            shell: true,
            cwd: options.cwd || state.path,
            timeout: options.timeout,
            env: options.env,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
          };
        } catch (error: unknown) {
          const err = error as { stdout?: string; stderr?: string; exitCode?: number };
          return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: err.exitCode || 1,
          };
        }
      },
    },
    git: {
      async status() {
        const { execa } = await import("execa");
        const result = await execa("git", ["status", "--porcelain", "-b"], { cwd: state.path });
        const lines = result.stdout.split("\n");
        const branchLine = lines[0] || "";
        const branch = branchLine.replace("## ", "").split("...")[0] || "main";
        return {
          branch,
          clean: lines.length <= 1,
          staged: [],
          unstaged: [],
          untracked: [],
        };
      },
      async commit(message: string, files?: string[]) {
        const { execa } = await import("execa");
        if (files && files.length > 0) {
          await execa("git", ["add", ...files], { cwd: state.path });
        }
        await execa("git", ["commit", "-m", message], { cwd: state.path });
      },
      async push() {
        const { execa } = await import("execa");
        await execa("git", ["push"], { cwd: state.path });
      },
    },
    test: {
      async run(pattern?: string) {
        const { execa } = await import("execa");
        try {
          const args = ["test", "--reporter=json"];
          if (pattern) args.push(pattern);
          await execa("pnpm", args, { cwd: state.path });
          return {
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
            failures: [],
          };
        } catch {
          return {
            passed: 0,
            failed: 1,
            skipped: 0,
            duration: 0,
            failures: [{ name: "test", message: "Tests failed" }],
          };
        }
      },
      async coverage() {
        return {
          lines: 0,
          branches: 0,
          functions: 0,
          statements: 0,
        };
      },
    },
    quality: {
      async lint(_files: string[]) {
        return {
          errors: 0,
          warnings: 0,
          issues: [],
        };
      },
      async complexity(_files: string[]) {
        return {
          averageComplexity: 0,
          maxComplexity: 0,
          files: [],
        };
      },
      async security(_files: string[]) {
        return {
          vulnerabilities: 0,
          issues: [],
        };
      },
    },
  };

  return {
    projectPath: state.path,
    config: {
      quality: {
        minScore: config.quality.minScore,
        minCoverage: config.quality.minCoverage,
        maxIterations: config.quality.maxIterations,
        convergenceThreshold: config.quality.convergenceThreshold,
      },
      timeouts: {
        phaseTimeout: 3600000,
        taskTimeout: 600000,
        llmTimeout: 120000,
      },
    },
    state: {
      artifacts: [],
      progress: 0,
      checkpoint: null,
    },
    tools,
    llm,
  };
}

/**
 * Create a state snapshot for rollback
 */
async function createSnapshot(state: ProjectState): Promise<ProjectState> {
  // Deep clone the state
  return JSON.parse(JSON.stringify(state)) as ProjectState;
}

/**
 * Maximum number of checkpoint versions to keep per phase
 */
const MAX_CHECKPOINT_VERSIONS = 5;

/**
 * Get all checkpoint files for a phase
 */
async function getCheckpointFiles(state: ProjectState, phase: string): Promise<string[]> {
  try {
    const fs = await import("node:fs/promises");
    const checkpointDir = `${state.path}/.coco/checkpoints`;
    const files = await fs.readdir(checkpointDir);

    // Filter files matching the phase pattern and sort by timestamp (newest first)
    const phaseFiles = files
      .filter(f => f.startsWith(`snapshot-pre-${phase}-`) && f.endsWith(".json"))
      .sort((a, b) => {
        // Extract timestamp from filename: snapshot-pre-phase-TIMESTAMP.json
        const tsA = parseInt(a.split("-").pop()?.replace(".json", "") ?? "0", 10);
        const tsB = parseInt(b.split("-").pop()?.replace(".json", "") ?? "0", 10);
        return tsB - tsA; // Newest first
      });

    return phaseFiles.map(f => `${checkpointDir}/${f}`);
  } catch {
    return [];
  }
}

/**
 * Clean up old checkpoint versions, keeping only the N most recent
 */
async function cleanupOldCheckpoints(state: ProjectState, phase: string): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const files = await getCheckpointFiles(state, phase);

    // Delete files beyond the max versions
    if (files.length > MAX_CHECKPOINT_VERSIONS) {
      const filesToDelete = files.slice(MAX_CHECKPOINT_VERSIONS);
      await Promise.all(filesToDelete.map(f => fs.unlink(f).catch(() => {})));
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Save snapshot to disk for recovery with version management
 */
async function saveSnapshot(state: ProjectState, snapshotId: string): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const snapshotPath = `${state.path}/.coco/checkpoints/snapshot-${snapshotId}.json`;

    const snapshotDir = `${state.path}/.coco/checkpoints`;
    await fs.mkdir(snapshotDir, { recursive: true });

    // Handle both Date objects and ISO strings
    const createdAt = state.createdAt instanceof Date
      ? state.createdAt.toISOString()
      : String(state.createdAt);
    const updatedAt = state.updatedAt instanceof Date
      ? state.updatedAt.toISOString()
      : String(state.updatedAt);

    await fs.writeFile(
      snapshotPath,
      JSON.stringify({
        ...state,
        createdAt,
        updatedAt,
        snapshotVersion: snapshotId,
        snapshotTimestamp: new Date().toISOString(),
      }, null, 2),
      "utf-8"
    );

    // Extract phase from snapshotId (format: pre-PHASE-TIMESTAMP)
    const phaseMatch = snapshotId.match(/^pre-(\w+)-/);
    if (phaseMatch && phaseMatch[1]) {
      await cleanupOldCheckpoints(state, phaseMatch[1]);
    }
  } catch {
    // Silently fail in test environment or if checkpoints can't be saved
    // The in-memory snapshot will still be used for rollback
  }
}

/**
 * List available checkpoint versions for a phase
 */
export async function listCheckpointVersions(
  projectPath: string,
  phase: string
): Promise<Array<{ id: string; timestamp: Date; path: string }>> {
  try {
    const fs = await import("node:fs/promises");
    const checkpointDir = `${projectPath}/.coco/checkpoints`;
    const files = await fs.readdir(checkpointDir);

    const versions: Array<{ id: string; timestamp: Date; path: string }> = [];

    for (const file of files) {
      if (file.startsWith(`snapshot-pre-${phase}-`) && file.endsWith(".json")) {
        const id = file.replace("snapshot-", "").replace(".json", "");
        const tsStr = id.split("-").pop();
        const timestamp = tsStr ? new Date(parseInt(tsStr, 10)) : new Date();
        versions.push({
          id,
          timestamp,
          path: `${checkpointDir}/${file}`,
        });
      }
    }

    // Sort by timestamp, newest first
    return versions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch {
    return [];
  }
}

/**
 * Load a specific checkpoint version
 */
export async function loadCheckpointVersion(
  projectPath: string,
  snapshotId: string
): Promise<ProjectState | null> {
  try {
    const fs = await import("node:fs/promises");
    const snapshotPath = `${projectPath}/.coco/checkpoints/snapshot-${snapshotId}.json`;
    const content = await fs.readFile(snapshotPath, "utf-8");
    const data = JSON.parse(content) as ProjectState;

    // Convert date strings back to Date objects
    data.createdAt = new Date(data.createdAt);
    data.updatedAt = new Date(data.updatedAt);

    return data;
  } catch {
    return null;
  }
}

/**
 * Restore state from snapshot
 */
function restoreFromSnapshot(target: ProjectState, snapshot: ProjectState): void {
  Object.assign(target, snapshot);
}

/**
 * Execute a phase with real executors and rollback support
 */
async function executePhase(
  phase: Phase,
  state: ProjectState,
  config: OrchestratorConfig
): Promise<PhaseResult> {
  const executor = getPhaseExecutor(phase);

  if (!executor) {
    return {
      phase: "idle",
      success: false,
      artifacts: [],
      error: `Unknown phase: ${phase}`,
    };
  }

  // Create snapshot before execution for rollback
  const snapshotId = `pre-${phase}-${Date.now()}`;
  const snapshot = await createSnapshot(state);
  await saveSnapshot(state, snapshotId);

  try {
    const context = await createPhaseContext(config, state);

    // Check if phase can start
    if (!executor.canStart(context)) {
      return {
        phase,
        success: false,
        artifacts: [],
        error: `Phase ${phase} cannot start in current state`,
      };
    }

    // Execute the phase
    const result = await executor.execute(context);

    // If phase failed, rollback to snapshot
    if (!result.success) {
      console.warn(`Phase ${phase} failed, rolling back to snapshot ${snapshotId}`);
      restoreFromSnapshot(state, snapshot);
      await saveState(state);
      return {
        ...result,
        error: `${result.error || "Phase failed"} (rolled back to pre-${phase} state)`,
      };
    }

    // Save state after successful execution
    await saveState(state);

    return result;
  } catch (error) {
    // Rollback on exception
    console.error(`Phase ${phase} threw exception, rolling back:`, error);
    restoreFromSnapshot(state, snapshot);
    await saveState(state);

    return {
      phase,
      success: false,
      artifacts: [],
      error: `${error instanceof Error ? error.message : String(error)} (rolled back)`,
    };
  }
}

/**
 * Calculate current progress
 */
function calculateProgress(state: ProjectState): Progress {
  const phaseOrder: Phase[] = ["converge", "orchestrate", "complete", "output"];
  const currentIndex = phaseOrder.indexOf(state.currentPhase);
  const overallProgress = currentIndex >= 0 ? currentIndex / phaseOrder.length : 0;

  // Ensure startedAt is a Date object (may be string after JSON parsing)
  const startedAt = state.createdAt instanceof Date
    ? state.createdAt
    : new Date(state.createdAt);

  return {
    phase: state.currentPhase,
    phaseProgress: 0, // TODO: Calculate based on phase-specific progress
    overallProgress,
    startedAt,
    task: state.currentTask
      ? {
          id: state.currentTask.id,
          title: state.currentTask.title,
          iteration: state.currentTask.iteration,
          currentScore: state.currentTask.scores.length > 0
            ? state.currentTask.scores[state.currentTask.scores.length - 1]?.overall ?? 0
            : 0,
        }
      : undefined,
  };
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
