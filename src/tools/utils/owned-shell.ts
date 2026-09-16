import type { ResultPromise } from "execa";
import { trackSubprocess } from "../../utils/subprocess-registry.js";

/** Own only the POSIX group created for this invocation; never search process names. */
export function ownShell(subprocess: ResultPromise, signal: AbortSignal) {
  const pid = subprocess.pid;
  let shutdown: Promise<void> | undefined;
  const signalGroup = (name: NodeJS.Signals) => {
    if (pid === undefined) return false;
    if (process.platform === "win32") {
      subprocess.kill(name);
      return false;
    }
    try {
      process.kill(-pid, name);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const stop = () => {
    shutdown ??= (async () => {
      if (!signalGroup("SIGTERM")) return;
      // Keep ownership during the grace period even if the shell has exited:
      // a descendant can retain its process group and ignore SIGTERM.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(25, deadline - Date.now())),
        );
        try {
          process.kill(-pid!, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
          throw error;
        }
      }
      signalGroup("SIGKILL");
    })();
    return shutdown;
  };
  const onAbort = () => {
    void stop().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  // Shell exit can precede pipe closure when descendants inherit stdout/stderr.
  subprocess.once?.("exit", onAbort);
  if (signal.aborted) onAbort();
  const completion = (async () => {
    try {
      return await subprocess;
    } finally {
      try {
        await stop();
      } finally {
        signal.removeEventListener("abort", onAbort);
        subprocess.off?.("exit", onAbort);
      }
    }
  })();
  // Global cleanup signals the same owned group, and retains ownership until
  // both subprocess settlement and group teardown have completed.
  trackSubprocess({
    killed: false,
    kill: (name: NodeJS.Signals = "SIGTERM") => signalGroup(name),
    then: (resolve, reject) => completion.then(resolve, reject),
  });
  return completion;
}
