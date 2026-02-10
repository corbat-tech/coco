/**
 * Open / Execute tool for Corbat-Coco
 *
 * Opens files with the system default application or executes
 * scripts and binaries with the appropriate interpreter.
 *
 * Open mode: delegates to the OS (macOS `open`, Linux `xdg-open`)
 * Exec mode: detects interpreter from extension or +x permissions
 */

import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

// ============================================================================
// Constants
// ============================================================================

/** Extension → interpreter mapping for exec mode */
const INTERPRETER_MAP: Record<string, string[]> = {
  ".py": ["python3"],
  ".sh": ["bash"],
  ".bash": ["bash"],
  ".zsh": ["zsh"],
  ".js": ["node"],
  ".ts": ["npx", "tsx"],
  ".rb": ["ruby"],
  ".pl": ["perl"],
  ".lua": ["lua"],
  ".php": ["php"],
};

/** System paths that should never be opened or executed */
const BLOCKED_PATHS = ["/etc", "/var", "/usr", "/root", "/sys", "/proc", "/boot", "/dev"];

/** Sensitive file patterns that should never be executed */
const BLOCKED_EXEC_PATTERNS = [
  /\.env(?:\.\w+)?$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /credentials\.\w+$/i,
  /secrets?\.\w+$/i,
];

/** Dangerous argument patterns */
const DANGEROUS_ARG_PATTERNS = [
  /\brm\s+-rf\s+\/(?!\w)/,
  /\bsudo\s+rm/,
  /\bdd\s+if=.*of=\/dev\//,
  /`[^`]+`/,
  /\$\([^)]+\)/,
  /\beval\s+/,
  /\bcurl\s+.*\|\s*(ba)?sh/,
];

// ============================================================================
// Helpers
// ============================================================================

function getSystemOpenCommand(): string {
  return process.platform === "darwin" ? "open" : "xdg-open";
}

function hasNullByte(str: string): boolean {
  return str.includes("\0");
}

function isBlockedPath(absolute: string): string | undefined {
  for (const blocked of BLOCKED_PATHS) {
    const normalizedBlocked = path.normalize(blocked);
    if (absolute === normalizedBlocked || absolute.startsWith(normalizedBlocked + path.sep)) {
      return blocked;
    }
  }
  return undefined;
}

function isBlockedExecFile(filePath: string): boolean {
  return BLOCKED_EXEC_PATTERNS.some((p) => p.test(filePath));
}

function hasDangerousArgs(args: string[]): boolean {
  const joined = args.join(" ");
  return DANGEROUS_ARG_PATTERNS.some((p) => p.test(joined));
}

function getInterpreter(ext: string): string[] | undefined {
  return INTERPRETER_MAP[ext.toLowerCase()];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Output type
// ============================================================================

export interface OpenFileOutput {
  action: "opened" | "executed";
  path: string;
  resolvedCommand: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration: number;
}

// ============================================================================
// Tool definition
// ============================================================================

export const openFileTool: ToolDefinition<
  {
    path: string;
    mode?: "open" | "exec";
    args?: string[];
    cwd?: string;
    timeout?: number;
  },
  OpenFileOutput
> = defineTool({
  name: "open_file",
  description: `Open a file with the system application or execute a script/binary.

Mode "open" (default): Opens the file with the OS default application.
- HTML files → browser
- Images → image viewer
- PDFs → PDF reader
- Directories → file manager

Mode "exec": Executes a script or binary.
- .py → python3, .sh → bash, .js → node, .ts → npx tsx
- .rb → ruby, .pl → perl, .lua → lua, .php → php
- Binaries with +x permissions → direct execution

Examples:
- Open in browser: { "path": "docs/index.html" }
- View image: { "path": "screenshot.png" }
- Run script: { "path": "scripts/setup.sh", "mode": "exec" }
- Run with args: { "path": "deploy.py", "mode": "exec", "args": ["--env", "staging"] }`,
  category: "bash",
  parameters: z.object({
    path: z.string().describe("File path to open or execute"),
    mode: z
      .enum(["open", "exec"])
      .optional()
      .default("open")
      .describe("open = system app, exec = run script"),
    args: z.array(z.string()).optional().default([]).describe("Arguments for exec mode"),
    cwd: z.string().optional().describe("Working directory"),
    timeout: z.number().optional().describe("Timeout in ms for exec mode (default 120000)"),
  }),

  async execute({ path: filePath, mode = "open", args = [], cwd, timeout }) {
    const start = performance.now();

    // --- Validate path ---
    if (!filePath || hasNullByte(filePath)) {
      throw new ToolError("Invalid file path", { tool: "open_file" });
    }

    const workDir = cwd ?? process.cwd();
    const absolute = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workDir, filePath);

    const blockedBy = isBlockedPath(absolute);
    if (blockedBy) {
      throw new ToolError(`Access to system path '${blockedBy}' is not allowed`, {
        tool: "open_file",
      });
    }

    // Verify file exists
    try {
      await fs.access(absolute);
    } catch {
      throw new ToolError(`File not found: ${absolute}`, { tool: "open_file" });
    }

    // --- Open mode ---
    if (mode === "open") {
      const cmd = getSystemOpenCommand();
      await execa(cmd, [absolute], { timeout: 10_000 });

      return {
        action: "opened" as const,
        path: absolute,
        resolvedCommand: cmd,
        duration: performance.now() - start,
      };
    }

    // --- Exec mode ---
    if (isBlockedExecFile(absolute)) {
      throw new ToolError(`Execution of sensitive file is blocked: ${path.basename(absolute)}`, {
        tool: "open_file",
      });
    }

    if (args.length > 0 && hasDangerousArgs(args)) {
      throw new ToolError("Arguments contain dangerous patterns", { tool: "open_file" });
    }

    const ext = path.extname(absolute);
    const interpreter = getInterpreter(ext);
    const executable = await isExecutable(absolute);

    let command: string;
    let cmdArgs: string[];

    if (interpreter) {
      command = interpreter[0]!;
      cmdArgs = [...interpreter.slice(1), absolute, ...args];
    } else if (executable) {
      command = absolute;
      cmdArgs = [...args];
    } else {
      throw new ToolError(
        `Cannot execute '${path.basename(absolute)}': no known interpreter for '${ext || "(no extension)"}' and file is not executable`,
        { tool: "open_file" },
      );
    }

    const result = await execa(command, cmdArgs, {
      cwd: workDir,
      timeout: timeout ?? 120_000,
      reject: false,
    });

    return {
      action: "executed" as const,
      path: absolute,
      resolvedCommand: interpreter ? interpreter.join(" ") : absolute,
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined,
      exitCode: result.exitCode ?? 0,
      duration: performance.now() - start,
    };
  },
});

export const openTools = [openFileTool];
