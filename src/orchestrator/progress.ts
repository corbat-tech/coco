/**
 * Progress Tracker with Checkpoint/Resume Support
 * Enhanced version with interruption handling
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

export interface OrchestratorState {
  sessionId: string;
  currentPhase: "converge" | "orchestrate" | "complete" | "output";
  tasks: any[];
  completedTasks: string[];
  agentStates: Map<string, any>;
  generatedFiles: any[];
  qualityHistory: any[];
  metadata: {
    startTime: number;
    lastCheckpoint: number;
    projectPath: string;
    provider: string;
  };
}

export interface CheckpointInfo {
  exists: boolean;
  path?: string;
  timestamp?: number;
  sessionId?: string;
  phase?: string;
}

/**
 * Progress Tracker with Checkpoint/Resume
 */
export class ProgressTracker {
  private checkpointDir: string;
  private currentSessionId: string;
  private autoCheckpointInterval: number;
  private autoCheckpointTimer?: NodeJS.Timeout;

  constructor(projectPath: string, sessionId?: string) {
    this.checkpointDir = path.join(projectPath, ".coco", "checkpoints");
    this.currentSessionId = sessionId || this.generateSessionId();
    this.autoCheckpointInterval = 30000; // 30 seconds
  }

  /**
   * Save checkpoint
   */
  async saveCheckpoint(state: OrchestratorState): Promise<void> {
    // Ensure checkpoint directory exists
    await fs.mkdir(this.checkpointDir, { recursive: true });

    const checkpointPath = this.getCheckpointPath(state.sessionId);

    // Convert Map to Object for JSON serialization
    const serializableState = {
      ...state,
      agentStates: Object.fromEntries(state.agentStates),
      metadata: {
        ...state.metadata,
        lastCheckpoint: Date.now(),
      },
    };

    // Write checkpoint
    await fs.writeFile(checkpointPath, JSON.stringify(serializableState, null, 2), "utf-8");

    console.log(`[ProgressTracker] Checkpoint saved: ${checkpointPath}`);
  }

  /**
   * Resume from checkpoint
   */
  async resume(sessionId?: string): Promise<OrchestratorState | null> {
    const targetSessionId = sessionId || this.currentSessionId;
    const checkpointPath = this.getCheckpointPath(targetSessionId);

    try {
      const content = await fs.readFile(checkpointPath, "utf-8");
      const state = JSON.parse(content);

      // Convert Object back to Map
      state.agentStates = new Map(Object.entries(state.agentStates || {}));

      console.log(`[ProgressTracker] Resumed from checkpoint: ${checkpointPath}`);
      console.log(`  Phase: ${state.currentPhase}`);
      console.log(`  Completed tasks: ${state.completedTasks.length}/${state.tasks.length}`);

      return state as OrchestratorState;
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        console.warn(`[ProgressTracker] No checkpoint found for session ${targetSessionId}`);
        return null;
      }

      throw error;
    }
  }

  /**
   * Check if checkpoint exists
   */
  async hasCheckpoint(sessionId?: string): Promise<CheckpointInfo> {
    const targetSessionId = sessionId || this.currentSessionId;
    const checkpointPath = this.getCheckpointPath(targetSessionId);

    try {
      const stats = await fs.stat(checkpointPath);
      const content = await fs.readFile(checkpointPath, "utf-8");
      const state = JSON.parse(content);

      return {
        exists: true,
        path: checkpointPath,
        timestamp: stats.mtimeMs,
        sessionId: state.sessionId,
        phase: state.currentPhase,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<CheckpointInfo[]> {
    try {
      const files = await fs.readdir(this.checkpointDir);
      const checkpoints: CheckpointInfo[] = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const sessionId = file.replace(".json", "");
          const info = await this.hasCheckpoint(sessionId);
          if (info.exists) {
            checkpoints.push(info);
          }
        }
      }

      // Sort by timestamp (newest first)
      checkpoints.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return checkpoints;
    } catch {
      return [];
    }
  }

  /**
   * Delete checkpoint
   */
  async deleteCheckpoint(sessionId: string): Promise<void> {
    const checkpointPath = this.getCheckpointPath(sessionId);

    try {
      await fs.unlink(checkpointPath);
      console.log(`[ProgressTracker] Deleted checkpoint: ${checkpointPath}`);
    } catch (error) {
      if ((error as any).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /**
   * Register interrupt handler (Ctrl+C)
   */
  registerInterruptHandler(onInterrupt: () => Promise<void>): void {
    const handler = async () => {
      console.log("\n⏸️  Interrupted. Saving checkpoint...");

      // Stop auto-checkpoint
      this.stopAutoCheckpoint();

      try {
        await onInterrupt();
        console.log("✅ Checkpoint saved. Resume with `coco resume`");
      } catch (error) {
        console.error("❌ Failed to save checkpoint:", error);
      }

      process.exit(0);
    };

    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  }

  /**
   * Start auto-checkpoint (periodic saves)
   */
  startAutoCheckpoint(state: () => OrchestratorState): void {
    this.stopAutoCheckpoint(); // Clear any existing timer

    this.autoCheckpointTimer = setInterval(async () => {
      try {
        await this.saveCheckpoint(state());
      } catch (error) {
        console.warn("[ProgressTracker] Auto-checkpoint failed:", error);
      }
    }, this.autoCheckpointInterval);

    console.log(
      `[ProgressTracker] Auto-checkpoint enabled (every ${this.autoCheckpointInterval / 1000}s)`,
    );
  }

  /**
   * Stop auto-checkpoint
   */
  stopAutoCheckpoint(): void {
    if (this.autoCheckpointTimer) {
      clearInterval(this.autoCheckpointTimer);
      this.autoCheckpointTimer = undefined;
    }
  }

  /**
   * Get checkpoint file path
   */
  private getCheckpointPath(sessionId: string): string {
    return path.join(this.checkpointDir, `${sessionId}.json`);
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 15);
    const hash = createHash("md5")
      .update(timestamp + random)
      .digest("hex");
    return hash.substring(0, 16);
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * Set checkpoint interval
   */
  setAutoCheckpointInterval(ms: number): void {
    this.autoCheckpointInterval = ms;
  }
}

/**
 * Create a progress tracker
 */
export function createProgressTracker(projectPath: string, sessionId?: string): ProgressTracker {
  return new ProgressTracker(projectPath, sessionId);
}
