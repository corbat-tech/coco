/** Command lifecycle shared by command-backed quality measurements. */
import { AsyncLocalStorage } from "node:async_hooks";
import { execa } from "execa";
import { createRequestScope } from "../utils/request-scope.js";
import { ownShell } from "../tools/utils/owned-shell.js";

const signals = new AsyncLocalStorage<AbortSignal | undefined>();
export function withQualitySignal<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return signals.run(signal, run);
}

export async function runQualityCommand(
  command: string,
  args: string[],
  options: { cwd: string; reject?: boolean; timeout?: number; cleanup?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const scope = createRequestScope(signals.getStore(), options.timeout ?? 120000);
  try {
    scope.signal.throwIfAborted();
    const process = execa(command, args, {
      cwd: options.cwd,
      reject: false,
      timeout: 0,
      detached: globalThis.process.platform !== "win32",
      maxBuffer: 16 * 1024 * 1024,
      encoding: "buffer",
      ...(globalThis.process.platform === "win32"
        ? { cancelSignal: scope.signal, forceKillAfterDelay: 3000 }
        : {}),
    });
    const result = await ownShell(process, scope.signal);
    scope.signal.throwIfAborted();
    if (
      result.signal ||
      result.isCanceled ||
      result.isMaxBuffer ||
      result.timedOut ||
      typeof result.exitCode !== "number"
    )
      throw new Error("Quality command did not complete normally");
    return {
      exitCode: result.exitCode,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
    };
  } finally {
    scope.dispose();
  }
}
