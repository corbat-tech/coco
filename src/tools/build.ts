/**
 * Build tools for Corbat-Coco
 * Wrappers for npm, pnpm, yarn, and make
 */

import { z } from "zod";
import { execa, type Options as ExecaOptions } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError, TimeoutError } from "../utils/errors.js";

/**
 * Default timeout for build commands (10 minutes)
 */
const DEFAULT_TIMEOUT_MS = 600000;

/**
 * Maximum output size (2MB)
 */
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024;

/**
 * Package manager type
 */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Build result interface
 */
export interface BuildResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  packageManager?: PackageManager;
}

/**
 * Detect package manager from lockfile
 */
async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const lockfiles: Array<{ file: string; pm: PackageManager }> = [
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "bun.lockb", pm: "bun" },
    { file: "package-lock.json", pm: "npm" },
  ];

  for (const { file, pm } of lockfiles) {
    try {
      await fs.access(path.join(cwd, file));
      return pm;
    } catch {
      // File doesn't exist, try next
    }
  }

  // Default to npm if no lockfile found
  return "npm";
}

/**
 * Truncate output if too long
 */
function truncateOutput(output: string, maxLength: number = 50000): string {
  if (output.length <= maxLength) {
    return output;
  }
  const truncated = output.slice(0, maxLength);
  return `${truncated}\n\n[Output truncated - ${output.length - maxLength} more characters]`;
}

/**
 * Run npm/pnpm/yarn script tool
 */
export const runScriptTool: ToolDefinition<
  {
    script: string;
    cwd?: string;
    packageManager?: PackageManager;
    args?: string[];
    env?: Record<string, string>;
    timeout?: number;
  },
  BuildResult
> = defineTool({
  name: "run_script",
  description: `Run a package.json script (npm/pnpm/yarn run).

Examples:
- Run build: { "script": "build" }
- Run test with args: { "script": "test", "args": ["--coverage"] }
- Specific PM: { "script": "dev", "packageManager": "pnpm" }
- With timeout: { "script": "build:slow", "timeout": 300000 }`,
  category: "build",
  parameters: z.object({
    script: z.string().describe("Script name from package.json"),
    cwd: z.string().optional().describe("Working directory"),
    packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional().describe("Package manager to use"),
    args: z.array(z.string()).optional().describe("Additional arguments"),
    env: z.record(z.string()).optional().describe("Environment variables"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute({ script, cwd, packageManager, args, env, timeout }) {
    const projectDir = cwd ?? process.cwd();
    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      // Detect or use provided package manager
      const pm = packageManager ?? await detectPackageManager(projectDir);

      // Build command
      const cmdArgs = ["run", script];
      if (args && args.length > 0) {
        cmdArgs.push("--", ...args);
      }

      const options: ExecaOptions = {
        cwd: projectDir,
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa(pm, cmdArgs, options);

      return {
        success: result.exitCode === 0,
        stdout: truncateOutput(String(result.stdout ?? "")),
        stderr: truncateOutput(String(result.stderr ?? "")),
        exitCode: result.exitCode ?? 0,
        duration: performance.now() - startTime,
        packageManager: pm,
      };
    } catch (error) {
      if ((error as { timedOut?: boolean }).timedOut) {
        throw new TimeoutError(`Script '${script}' timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: `run ${script}`,
        });
      }

      throw new ToolError(
        `Failed to run script '${script}': ${error instanceof Error ? error.message : String(error)}`,
        { tool: "run_script", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Install dependencies tool
 */
export const installDepsTool: ToolDefinition<
  {
    cwd?: string;
    packageManager?: PackageManager;
    packages?: string[];
    dev?: boolean;
    frozen?: boolean;
    timeout?: number;
  },
  BuildResult
> = defineTool({
  name: "install_deps",
  description: `Install package dependencies.

Examples:
- Install all: {}
- Install specific: { "packages": ["lodash", "typescript"] }
- Dev dependency: { "packages": ["vitest"], "dev": true }
- Frozen lockfile: { "frozen": true }`,
  category: "build",
  parameters: z.object({
    cwd: z.string().optional().describe("Working directory"),
    packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional().describe("Package manager"),
    packages: z.array(z.string()).optional().describe("Specific packages to install"),
    dev: z.boolean().optional().default(false).describe("Install as dev dependency"),
    frozen: z.boolean().optional().default(false).describe("Use frozen lockfile (CI mode)"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute({ cwd, packageManager, packages, dev, frozen, timeout }) {
    const projectDir = cwd ?? process.cwd();
    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      const pm = packageManager ?? await detectPackageManager(projectDir);

      // Build command based on package manager
      let cmdArgs: string[];

      if (packages && packages.length > 0) {
        // Installing specific packages
        switch (pm) {
          case "pnpm":
            cmdArgs = ["add", ...packages];
            if (dev) cmdArgs.push("-D");
            break;
          case "yarn":
            cmdArgs = ["add", ...packages];
            if (dev) cmdArgs.push("--dev");
            break;
          case "bun":
            cmdArgs = ["add", ...packages];
            if (dev) cmdArgs.push("--dev");
            break;
          default: // npm
            cmdArgs = ["install", ...packages];
            if (dev) cmdArgs.push("--save-dev");
        }
      } else {
        // Installing all dependencies
        switch (pm) {
          case "pnpm":
            cmdArgs = frozen ? ["install", "--frozen-lockfile"] : ["install"];
            break;
          case "yarn":
            cmdArgs = frozen ? ["install", "--frozen-lockfile"] : ["install"];
            break;
          case "bun":
            cmdArgs = frozen ? ["install", "--frozen-lockfile"] : ["install"];
            break;
          default: // npm
            cmdArgs = frozen ? ["ci"] : ["install"];
        }
      }

      const options: ExecaOptions = {
        cwd: projectDir,
        timeout: timeoutMs,
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa(pm, cmdArgs, options);

      return {
        success: result.exitCode === 0,
        stdout: truncateOutput(String(result.stdout ?? "")),
        stderr: truncateOutput(String(result.stderr ?? "")),
        exitCode: result.exitCode ?? 0,
        duration: performance.now() - startTime,
        packageManager: pm,
      };
    } catch (error) {
      if ((error as { timedOut?: boolean }).timedOut) {
        throw new TimeoutError(`Install timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: "install",
        });
      }

      throw new ToolError(
        `Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "install_deps", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Run make target tool
 */
export const makeTool: ToolDefinition<
  {
    target?: string;
    cwd?: string;
    args?: string[];
    env?: Record<string, string>;
    timeout?: number;
  },
  BuildResult
> = defineTool({
  name: "make",
  description: `Run a Makefile target.

Examples:
- Default target: {}
- Specific target: { "target": "build" }
- With variables: { "target": "test", "args": ["VERBOSE=1"] }
- Multiple targets: { "target": "clean build" }`,
  category: "build",
  parameters: z.object({
    target: z.string().optional().describe("Make target(s) to run"),
    cwd: z.string().optional().describe("Working directory"),
    args: z.array(z.string()).optional().describe("Additional arguments or variables"),
    env: z.record(z.string()).optional().describe("Environment variables"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute({ target, cwd, args, env, timeout }) {
    const projectDir = cwd ?? process.cwd();
    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      // Check if Makefile exists
      try {
        await fs.access(path.join(projectDir, "Makefile"));
      } catch {
        throw new ToolError("No Makefile found in directory", { tool: "make" });
      }

      const cmdArgs: string[] = [];
      if (target) {
        // Split target in case multiple targets specified
        cmdArgs.push(...target.split(/\s+/));
      }
      if (args && args.length > 0) {
        cmdArgs.push(...args);
      }

      const options: ExecaOptions = {
        cwd: projectDir,
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa("make", cmdArgs, options);

      return {
        success: result.exitCode === 0,
        stdout: truncateOutput(String(result.stdout ?? "")),
        stderr: truncateOutput(String(result.stderr ?? "")),
        exitCode: result.exitCode ?? 0,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;

      if ((error as { timedOut?: boolean }).timedOut) {
        throw new TimeoutError(`Make timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: `make ${target ?? ""}`,
        });
      }

      throw new ToolError(
        `Make failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "make", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * TypeScript compile tool
 */
export const tscTool: ToolDefinition<
  {
    cwd?: string;
    project?: string;
    noEmit?: boolean;
    watch?: boolean;
    args?: string[];
    timeout?: number;
  },
  BuildResult
> = defineTool({
  name: "tsc",
  description: `Run TypeScript compiler.

Examples:
- Type check only: { "noEmit": true }
- Build: {}
- Custom project: { "project": "tsconfig.build.json" }
- With args: { "args": ["--declaration"] }`,
  category: "build",
  parameters: z.object({
    cwd: z.string().optional().describe("Working directory"),
    project: z.string().optional().describe("Path to tsconfig.json"),
    noEmit: z.boolean().optional().default(false).describe("Only type check, don't emit"),
    watch: z.boolean().optional().default(false).describe("Watch mode"),
    args: z.array(z.string()).optional().describe("Additional tsc arguments"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute({ cwd, project, noEmit, watch, args, timeout }) {
    const projectDir = cwd ?? process.cwd();
    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      const cmdArgs: string[] = [];

      if (project) {
        cmdArgs.push("--project", project);
      }
      if (noEmit) {
        cmdArgs.push("--noEmit");
      }
      if (watch) {
        cmdArgs.push("--watch");
      }
      if (args && args.length > 0) {
        cmdArgs.push(...args);
      }

      const options: ExecaOptions = {
        cwd: projectDir,
        timeout: timeoutMs,
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa("npx", ["tsc", ...cmdArgs], options);

      return {
        success: result.exitCode === 0,
        stdout: truncateOutput(String(result.stdout ?? "")),
        stderr: truncateOutput(String(result.stderr ?? "")),
        exitCode: result.exitCode ?? 0,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if ((error as { timedOut?: boolean }).timedOut) {
        throw new TimeoutError(`TypeScript compile timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: "tsc",
        });
      }

      throw new ToolError(
        `TypeScript compile failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "tsc", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * All build tools
 */
export const buildTools = [
  runScriptTool,
  installDepsTool,
  makeTool,
  tscTool,
];
