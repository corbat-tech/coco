import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FileCheckpoint } from "./types.js";
const hash = (content: string) => createHash("sha256").update(content).digest("hex");

/** Validate the entire set before writing any file; never alter the Git index. */
export async function restoreCheckpointFiles(files: FileCheckpoint[], projectPath: string) {
  const restored: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  const root = await fs.realpath(projectPath);
  const inspect = async (file: FileCheckpoint) => {
    if (!path.isAbsolute(file.filePath)) throw new Error("Checkpoint path must be absolute");
    const raw = path.resolve(file.filePath);
    const lexical = path.relative(path.resolve(projectPath), raw);
    const target =
      lexical !== ".." && !lexical.startsWith(`..${path.sep}`) && !path.isAbsolute(lexical)
        ? path.resolve(root, lexical)
        : raw;
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).some((part) => [".git", ".coco"].includes(part.toLowerCase()))
    )
      throw new Error("Checkpoint path outside project");
    if ((await fs.realpath(path.dirname(target))) !== path.dirname(target))
      throw new Error("Checkpoint parent resolves through a symlink");
    if (typeof file.originalExists !== "boolean" || typeof file.newExists !== "boolean")
      throw new Error(
        "Legacy checkpoint lacks verified before/after state; automatic restoration unavailable",
      );
    let exists = false;
    let content = "";
    try {
      const info = await fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024)
        throw new Error("Checkpoint target is not a regular file");
      const bytes = await fs.readFile(target);
      content = bytes.toString("utf8");
      if (!Buffer.from(content).equals(bytes))
        throw new Error("Checkpoint target is not valid UTF-8");
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      exists !== file.newExists ||
      (exists && (file.newContent === undefined || hash(content) !== hash(file.newContent)))
    )
      throw new Error("Checkpoint conflict: file changed after the recorded operation");
    return target;
  };
  for (const file of files) {
    try {
      await inspect(file);
    } catch (error) {
      failed.push({
        path: file.filePath,
        error: error instanceof Error ? error.message : "Checkpoint inspection failed",
      });
    }
  }
  if (failed.length) return { restored, failed };
  for (const file of files) {
    try {
      // Recheck after preflight to avoid overwriting an observed intervening edit.
      const target = await inspect(file);
      if (file.originalExists) {
        const handle = await fs.open(
          target,
          file.newExists
            ? constants.O_RDWR | constants.O_NOFOLLOW
            : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o666,
        );
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1)
            throw new Error("Checkpoint target changed during restoration");
          if (file.newExists) {
            const bytes = await handle.readFile();
            if (!Buffer.from(file.newContent!).equals(bytes))
              throw new Error("Checkpoint target changed during restoration");
          }
          const original = Buffer.from(file.originalContent);
          let offset = 0;
          while (offset < original.length) {
            const { bytesWritten } = await handle.write(
              original,
              offset,
              original.length - offset,
              offset,
            );
            if (bytesWritten === 0)
              throw new Error("Checkpoint restoration could not write content");
            offset += bytesWritten;
          }
          await handle.truncate(original.length);
        } finally {
          await handle.close();
        }
      } else if (file.newExists) await fs.unlink(target);
      restored.push(file.filePath);
    } catch (error) {
      failed.push({
        path: file.filePath,
        error: error instanceof Error ? error.message : "Checkpoint restoration failed",
      });
      break;
    }
  }
  return { restored, failed };
}
