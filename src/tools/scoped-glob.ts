/** Keep glob's pattern engine while authorizing every filesystem access. */
import fs from "node:fs/promises";
import { glob, type FSOption } from "glob";
import { ToolError } from "../utils/errors.js";
import { resolvePathSecurely } from "./file-path-policy.js";

export async function scopedGlob(
  pattern: string,
  cwd: string,
  ignore: string[],
): Promise<string[]> {
  if (pattern.includes("\0"))
    throw new ToolError("Glob pattern contains invalid characters", { tool: "glob" });
  const root = await resolvePathSecurely(cwd, "read");
  let failure: unknown;
  // path-scurry treats filesystem failures as empty results. Preserve denial
  // separately so it cannot be reported as a successful, incomplete search.
  async function guarded<T>(
    entry: string,
    operation: (canonical: string) => Promise<T>,
  ): Promise<T> {
    try {
      const canonical = await resolvePathSecurely(entry, "read");
      return await operation(canonical);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") failure ??= error;
      throw error;
    }
  }
  const rejectSync = (): never => {
    const error = new ToolError("Synchronous glob filesystem access is unsupported", {
      tool: "glob",
    });
    failure ??= error;
    throw error;
  };
  const scopedFs: FSOption = {
    lstatSync: rejectSync,
    readdirSync: rejectSync,
    readlinkSync: rejectSync,
    realpathSync: rejectSync,
    readdir(entry, options, callback) {
      void guarded(entry, (canonical) => fs.readdir(canonical, options)).then(
        (entries) => callback(null, entries),
        (error: NodeJS.ErrnoException) => callback(error),
      );
    },
    promises: {
      // Preserve symlink metadata after checking its destination's authority.
      lstat: (entry) => guarded(entry, () => fs.lstat(entry)),
      readdir: (entry, options) => guarded(entry, (canonical) => fs.readdir(canonical, options)),
      readlink: (entry) => guarded(entry, () => fs.readlink(entry)),
      realpath: (entry) => guarded(entry, async (canonical) => canonical),
    },
  };
  const files = await glob(pattern, { cwd: root, ignore, absolute: true, fs: scopedFs });
  if (failure) throw failure;
  // Known Dirents can match without another stat: authorize those results too.
  for (const file of files) await resolvePathSecurely(file, "read");
  return files;
}
