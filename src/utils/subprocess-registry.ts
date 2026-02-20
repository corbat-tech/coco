/**
 * Subprocess Registry — tracks all active execa child processes
 * and ensures they are killed on parent exit or signal.
 *
 * Usage:
 *   const proc = execa("npx", ["vitest", "run"], { cleanup: true });
 *   trackSubprocess(proc);
 *   const result = await proc;
 */

import type { ResultPromise } from "execa";

/** Subset of execa subprocess we need for lifecycle management */
export interface TrackedProcess {
  killed: boolean;
  // Broad kill signature compatible with both execa ResultPromise and our mocks.
  // execa uses (signal?: number | Signals, error?: Error) — NodeJS.Signals covers
  // "SIGTERM" | "SIGKILL" etc., so we accept any string to avoid the import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kill: (...args: any[]) => unknown;
  then(onFulfilled: () => void, onRejected: () => void): unknown;
}

const activeSubprocesses = new Set<TrackedProcess>();
let cleanupRegistered = false;

/**
 * Track an execa subprocess.
 * Returns the subprocess unchanged (fluent usage).
 */
export function trackSubprocess<T extends TrackedProcess>(proc: T): T {
  activeSubprocesses.add(proc);
  // Use .then(onFulfilled, onRejected) so the cleanup always runs but the
  // returned Promise always fulfills — avoids an unhandled rejection when the
  // subprocess fails and the caller already catches the original `proc`.
  const cleanup = () => activeSubprocesses.delete(proc);
  proc.then(cleanup, cleanup);
  return proc;
}

/**
 * Send signal to all active subprocesses.
 * For SIGTERM, escalates to SIGKILL after 3 seconds if the process is still alive.
 */
export async function killAllSubprocesses(
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): Promise<void> {
  const kills = Array.from(activeSubprocesses).map(async (proc) => {
    try {
      if (!proc.killed) {
        proc.kill(signal);
        if (signal === "SIGTERM") {
          // Escalate to SIGKILL after 3 s if still running
          await new Promise<void>((resolve) => setTimeout(resolve, 3000));
          if (!proc.killed) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // Already exited between the check and the kill
            }
          }
        }
      }
    } catch {
      // Process may have already exited
    }
  });

  await Promise.allSettled(kills);
  activeSubprocesses.clear();
}

/**
 * Attempt to find and kill orphaned vitest/jest worker processes
 * that survived a previous crash.
 *
 * Returns the number of processes signaled.
 */
export async function killOrphanedTestProcesses(): Promise<number> {
  if (process.platform === "win32") {
    // Windows: skip — tasklist doesn't expose command-line args easily
    return 0;
  }

  let killed = 0;
  try {
    const { execa } = await import("execa");
    const result = await execa("pgrep", ["-f", "vitest|jest.*--worker"], {
      reject: false,
    });

    const pids = result.stdout
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid && pid !== process.ppid);

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed++;
        // Escalate after 3 s
        setTimeout(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Already dead
          }
        }, 3000);
      } catch {
        // Process already gone
      }
    }
  } catch {
    // pgrep not available or other error — silently skip
  }

  return killed;
}

/**
 * Register global SIGINT / SIGTERM / exit handlers that kill all tracked
 * subprocesses on parent shutdown.
 *
 * Safe to call multiple times — only registers once.
 */
export function registerGlobalCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = async (signal: string) => {
    await killAllSubprocesses("SIGTERM");
    // Re-raise the signal so the process exits with the correct code
    process.kill(process.pid, signal as NodeJS.Signals);
  };

  process.once("SIGINT", () => void cleanup("SIGINT"));
  process.once("SIGTERM", () => void cleanup("SIGTERM"));

  // Synchronous best-effort SIGKILL on final exit (no await possible here)
  process.on("exit", () => {
    for (const proc of activeSubprocesses) {
      try {
        if (!proc.killed) proc.kill("SIGKILL");
      } catch {
        // Ignore
      }
    }
  });
}

/**
 * Exposed for testing — returns the current size of the active set.
 * @internal
 */
export function _activeSubprocessCount(): number {
  return activeSubprocesses.size;
}

// Re-export TrackedProcess so callers don't need to import it separately
export type { ResultPromise };
