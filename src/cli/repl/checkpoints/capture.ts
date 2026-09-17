import * as fs from "node:fs/promises";
import path from "node:path";
import type { ToolDispatch } from "../parallel-executor.js";
import { getCheckpointManager, type CheckpointManager } from "./manager.js";

/** Capture only bounded regular-file tools; shell/remote effects are never claimed reversible. */
export function withFileCheckpoints(
  dispatch: ToolDispatch,
  sessionId: string,
  projectPath: string,
  manager: CheckpointManager = getCheckpointManager(),
): ToolDispatch {
  let pending = Promise.resolve();
  return async (call, signal) => {
    if (
      !["write_file", "edit_file", "delete_file"].includes(call.name) ||
      typeof call.input.path !== "string" ||
      call.input.dryRun === true ||
      call.input.path.includes("\0") ||
      call.input.path.startsWith("~")
    )
      return dispatch(call, signal);
    // Serialize file mutations so each postimage belongs to exactly one operation.
    const previous = pending;
    let release!: () => void;
    pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      signal?.throwIfAborted();
      // Capture is optional evidence, not a second execution/permission boundary.
      // A missing project cannot produce a restorable snapshot; the dispatcher
      // still decides whether the requested operation is valid and authorized.
      const root = await fs.realpath(projectPath).catch(() => undefined);
      if (!root) return dispatch(call, signal);
      // Match file tools: relative input resolves against the host cwd, not -p.
      const requested = path.resolve(call.input.path);
      const lexical = path.relative(path.resolve(projectPath), requested);
      const filePath =
        lexical !== ".." && !lexical.startsWith(`..${path.sep}`) && !path.isAbsolute(lexical)
          ? path.resolve(root, lexical)
          : requested;
      const relative = path.relative(root, filePath);
      let checkpoint;
      if (
        relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) &&
        !relative.split(path.sep).some((part) => [".git", ".coco"].includes(part.toLowerCase()))
      ) {
        try {
          const parent = await fs.realpath(path.dirname(filePath));
          let supported = parent === path.dirname(filePath);
          try {
            const info = await fs.lstat(filePath);
            supported &&=
              info.isFile() &&
              !info.isSymbolicLink() &&
              info.nlink === 1 &&
              info.size <= 1024 * 1024;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (supported) {
            const bytes = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            });
            if (!bytes || Buffer.from(bytes.toString("utf8")).equals(bytes))
              checkpoint = await manager.createFileCheckpoint(
                sessionId,
                filePath,
                call.name,
                call.id,
              );
          }
        } catch {
          /* Unsupported paths remain executable but are never advertised as reversible. */
        }
      }
      const result = await dispatch(call, signal);
      if (result.success && checkpoint) {
        try {
          const info = await fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          });
          if (
            !info ||
            (info.isFile() &&
              !info.isSymbolicLink() &&
              info.nlink === 1 &&
              info.size <= 1024 * 1024)
          ) {
            const bytes = info ? await fs.readFile(filePath) : undefined;
            if (bytes && !Buffer.from(bytes.toString("utf8")).equals(bytes)) return result;
            const after = bytes?.toString("utf8");
            await manager.storeAutoFileCheckpoint(sessionId, {
              ...checkpoint,
              newExists: Boolean(info),
              newContent: after,
            });
          }
        } catch {
          /* A missing checkpoint must not turn an already executed effect into a retryable failure. */
        }
      }
      return result;
    } finally {
      release();
    }
  };
}
