import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { resolvePathSecurely } from "./file-path-policy.js";
import { ToolError } from "../utils/errors.js";

/** Read regular project files without following links or loading oversized payloads. */
export async function readMediaFile(
  file: string,
  tool: string,
  formats: Record<string, string>,
  maxBytes: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const root = await fs.realpath(process.cwd());
  const resolved = await resolvePathSecurely(file, "read");
  if (!resolved.startsWith(root + path.sep))
    throw new ToolError("Media must be inside the project directory.", { tool });
  const mimeType = formats[path.extname(resolved).toLowerCase()];
  if (!mimeType)
    throw new ToolError(`Unsupported format. Use ${Object.keys(formats).join(", ")}.`, { tool });
  const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1)
      throw new ToolError("Media must be a regular file with one link.", { tool });
    if (stat.size > maxBytes || stat.size === 0)
      throw new ToolError(`Media must be nonempty and at most ${maxBytes} bytes.`, { tool });
    const bytes = await handle.readFile({ signal });
    if (bytes.length > maxBytes) throw new ToolError("Media exceeds size limit.", { tool });
    return { bytes, mimeType, path: resolved };
  } finally {
    await handle.close();
  }
}

/** Resolve and validate output before a paid request; never overwrite an existing artifact. */
export async function mediaOutputPath(requested?: string): Promise<string> {
  const root = await fs.realpath(process.cwd());
  const resolved = await resolvePathSecurely(
    requested ?? `.coco/artifacts/media/${crypto.randomUUID()}.png`,
    "write",
  );
  if (!resolved.startsWith(root + path.sep) || path.extname(resolved).toLowerCase() !== ".png")
    throw new ToolError("Image destination must be a .png file inside the project.", {
      tool: "generate_image",
    });
  try {
    await fs.lstat(resolved);
    throw new ToolError("Image destination already exists.", { tool: "generate_image" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

export async function saveMediaArtifact(
  destination: string,
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const checked = await mediaOutputPath(destination);
  const handle = await fs.open(
    checked,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes, { signal });
  } catch (error) {
    await fs.unlink(checked).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
}

export const IMAGE_FORMATS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
export const AUDIO_FORMATS = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
};
