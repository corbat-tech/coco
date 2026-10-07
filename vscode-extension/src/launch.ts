import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

/** Resolve one executable, never a shell command or workspace-relative program. */
export async function resolveExecutable(configured: string): Promise<string> {
  const value = configured.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
  if (!value || /[\r\n\0]/.test(value))
    throw new Error("coco.cliPath must name a single executable.");
  const absolute = isAbsolute(value);
  if (!absolute && (value.includes("/") || value.includes("\\") || /\s/.test(value))) {
    throw new Error(
      "Use an absolute executable path or a command name on PATH, without arguments.",
    );
  }
  const candidates = absolute
    ? [value]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter((entry) => isAbsolute(entry))
        .flatMap((entry) =>
          process.platform === "win32"
            ? [join(entry, value), join(entry, `${value}.exe`)]
            : [join(entry, value)],
        );
  for (const candidate of candidates) {
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) continue;
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* Try the next PATH directory. */
    }
  }
  throw new Error(
    "COCO executable not found. Install @corbat-tech/coco and set coco.cliPath to its executable. Shell commands and Windows .cmd/.bat wrappers are not supported.",
  );
}
