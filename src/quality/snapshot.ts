/** Content identity for quality evidence; includes tests and configuration, not build output. */
import { createHash } from "node:crypto";
import { lstat, readlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { glob } from "glob";
import { join } from "node:path";
import type { QualitySnapshot } from "./types.js";

export async function createQualitySnapshot(projectPath: string): Promise<QualitySnapshot> {
  if (!(await stat(projectPath)).isDirectory())
    throw new Error("Quality project must be a directory");
  const paths = await glob("**/*", {
    cwd: projectPath,
    dot: true,
    nodir: true,
    follow: false,
    ignore: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.coverage/**",
      "**/.coco/**",
      "**/target/**",
      "**/.cache/**",
      "**/.next/**",
      "**/.venv/**",
      "**/venv/**",
    ],
  });
  const files: Record<string, string> = {};
  for (const path of paths.sort()) {
    const absolute = join(projectPath, path);
    const info = await lstat(absolute);
    const hash = createHash("sha256");
    if (info.isSymbolicLink()) hash.update(`symlink:${await readlink(absolute)}`);
    else {
      if (!info.isFile()) throw new Error("Unsupported special file in quality snapshot");
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
    }
    files[path] = hash.digest("hex");
  }
  return { files, hash: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

export async function isQualitySnapshotCurrent(
  projectPath: string,
  snapshot: QualitySnapshot,
): Promise<boolean> {
  try {
    return (await createQualitySnapshot(projectPath)).hash === snapshot.hash;
  } catch {
    return false;
  }
}
