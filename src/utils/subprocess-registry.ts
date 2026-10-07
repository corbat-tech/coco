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

const activeSubprocesses = new Map<TrackedProcess, Promise<void>>();
let cleanupRegistered = false;

/**
 * Track an execa subprocess.
 * Returns the subprocess unchanged (fluent usage).
 */
export function trackSubprocess<T extends TrackedProcess>(proc: T): T {
  if (activeSubprocesses.has(proc)) return proc;
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  activeSubprocesses.set(proc, completion);
  // Signal delivery (proc.killed) is not evidence of process termination.
  const cleanup = () => {
    activeSubprocesses.delete(proc);
    finish();
  };
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
  // Snapshot ownership: new processes registered while waiting belong to a later cleanup.
  const owned = Array.from(activeSubprocesses.entries());
  await Promise.allSettled(
    owned.map(async ([proc, completion]) => {
      if (!activeSubprocesses.has(proc)) return;
      try {
        proc.kill(signal);
      } catch {
        // A failed signal does not prove the process has exited.
      }
      if (signal === "SIGKILL" || !activeSubprocesses.has(proc)) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (activeSubprocesses.has(proc)) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Keep tracking until settlement; neither signal delivery nor failure proves exit.
        }
      }
    }),
  );
}

/**
 * @deprecated Process names cannot establish ownership. Kept as a harmless
 * compatibility shim; only explicitly tracked subprocesses may be cleaned up.
 */
export async function killOrphanedTestProcesses(): Promise<number> {
  return 0;
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
    for (const proc of activeSubprocesses.keys()) {
      try {
        proc.kill("SIGKILL");
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
