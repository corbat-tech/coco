/** Application-level file scopes for trusted local projects; not an OS sandbox. */
import fs from "node:fs/promises";
import path from "node:path";
import { getAllowedPaths, type AllowedPathEntry } from "./allowed-paths.js";
import { ToolError } from "../utils/errors.js";

const SENSITIVE_PATTERNS = [
  /\.env(?:\.\w+)?$/, // .env, .env.local, etc.
  /credentials\.\w+$/i, // credentials.json, etc.
  /secrets?\.\w+$/i, // secret.json, secrets.yaml
  /\.pem$/, // Private keys
  /\.key$/, // Private keys
  /id_rsa(?:\.pub)?$/, // SSH keys
  /\.npmrc$/, // npm auth
  /\.pypirc$/, // PyPI auth
];

/**
 * System paths that should be blocked
 */
const BLOCKED_PATHS = ["/etc", "/var", "/usr", "/root", "/sys", "/proc", "/boot"];
const SAFE_COCO_HOME_READ_FILES = new Set([
  "mcp.json",
  "config.json",
  "COCO.md",
  "AGENTS.md",
  "CLAUDE.md",
  "projects.json",
  "trusted-tools.json",
  "allowed-paths.json",
]);
const SAFE_COCO_HOME_READ_DIR_PREFIXES = ["skills", "memories", "logs", "checkpoints", "sessions"];

function isWithinDirectory(targetPath: string, baseDir: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isSafeCocoHomeReadPath(absolutePath: string, homeDir: string): boolean {
  const cocoHome = path.join(homeDir, ".coco");
  if (!isWithinDirectory(absolutePath, cocoHome)) {
    return false;
  }

  const relativePath = path.relative(cocoHome, absolutePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  const segments = relativePath.split(path.sep).filter(Boolean);
  const firstSegment = segments[0];
  if (!firstSegment) {
    return false;
  }

  if (firstSegment === "tokens" || firstSegment === ".env") {
    return false;
  }

  if (segments.length === 1 && SAFE_COCO_HOME_READ_FILES.has(firstSegment)) {
    return true;
  }

  return SAFE_COCO_HOME_READ_DIR_PREFIXES.includes(firstSegment);
}

export interface PathPolicyOptions {
  projectRoot?: string;
  allowedPaths?: AllowedPathEntry[];
  allowHomeConfigReads?: boolean;
  /** unlink/rename act on the directory entry, not a symlink target. */
  followLeaf?: boolean;
}

function userPath(input: string, root: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && (input === "~" || input.startsWith("~/"))) input = path.join(home, input.slice(2));
  return path.resolve(root, input);
}

/** Canonicalize a new destination through its nearest existing ancestor. */
async function canonicalPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling link is an existing directory entry. Do not treat it as a
    // creatable path: writeFile/mkdir could follow it outside the approved root.
    try {
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink())
        throw new ToolError("Dangling symlink is not allowed", { tool: "file_path" });
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
    }
    const parent = path.dirname(input);
    if (parent === input) throw error;
    return path.join(await canonicalPath(parent), path.basename(input));
  }
}

export async function resolvePathSecurely(
  filePath: string,
  operation: "read" | "write" | "delete",
  options: PathPolicyOptions = {},
): Promise<string> {
  if (filePath.includes("\0"))
    throw new ToolError("Path contains invalid characters", { tool: `file_${operation}` });
  const root = path.resolve(options.projectRoot ?? process.cwd());
  const absolute = userPath(filePath, root);
  const canonicalRoot = await canonicalPath(root);
  const canonical = await canonicalPath(absolute);
  const grants = options.allowedPaths ?? getAllowedPaths();
  const home = process.env.HOME || process.env.USERPROFILE;
  const homeRead = (candidate: string, homeDir: string): boolean =>
    isSafeCocoHomeReadPath(candidate, homeDir) ||
    [".gitconfig", ".zshrc", ".bashrc"].some((name) => candidate === path.join(homeDir, name));

  const allowed = async (): Promise<boolean> => {
    // Check both names and targets: a project symlink cannot import an arbitrary
    // external scope, while platform aliases of the project root remain valid.
    if (isWithinDirectory(absolute, root) && isWithinDirectory(canonical, canonicalRoot))
      return true;
    if (isWithinDirectory(absolute, canonicalRoot) && isWithinDirectory(canonical, canonicalRoot))
      return true;
    for (const blocked of BLOCKED_PATHS) {
      if (isWithinDirectory(absolute, blocked)) {
        throw new ToolError(`Access to system path '${blocked}' is not allowed`, {
          tool: `file_${operation}`,
        });
      }
    }
    for (const entry of grants) {
      if (operation !== "read" && entry.level !== "write") continue;
      const grantRoot = path.resolve(entry.path);
      const canonicalGrant = await canonicalPath(grantRoot);
      if (
        (isWithinDirectory(absolute, grantRoot) || isWithinDirectory(absolute, canonicalGrant)) &&
        isWithinDirectory(canonical, canonicalGrant)
      )
        return true;
      // A link from the project to an explicitly granted destination is allowed.
      if (isWithinDirectory(absolute, root) && isWithinDirectory(canonical, canonicalGrant))
        return true;
    }
    if (operation === "read" && options.allowHomeConfigReads !== false && home) {
      const canonicalHome = await canonicalPath(home);
      if (homeRead(absolute, home) && homeRead(canonical, canonicalHome)) return true;
    }
    return false;
  };
  if (!(await allowed())) {
    const reason =
      operation === "read"
        ? "Reading files outside project directory is not allowed"
        : `${operation} operations outside project directory are not allowed`;
    throw new ToolError(`${reason}. Use /allow-path ${path.dirname(absolute)} to grant access.`, {
      tool: `file_${operation}`,
    });
  }
  if (operation !== "read") {
    for (const candidate of [absolute, canonical]) {
      const basename = path.basename(candidate);
      if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(basename))) {
        throw new ToolError(
          `Operation on sensitive file '${basename}' requires explicit confirmation`,
          { tool: `file_${operation}` },
        );
      }
    }
  }
  return options.followLeaf === false || operation === "delete"
    ? path.join(await canonicalPath(path.dirname(absolute)), path.basename(absolute))
    : canonical;
}
