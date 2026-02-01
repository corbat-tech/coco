/**
 * Bash/Shell tools for Corbat-Coco
 * Execute shell commands with safety controls
 */

import { z } from "zod";
import { execa, type Options as ExecaOptions } from "execa";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError, TimeoutError } from "../utils/errors.js";

/**
 * Default timeout for commands (2 minutes)
 */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Maximum output size (1MB)
 */
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Dangerous commands that should be blocked or warned
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\/(?!\w)/,   // rm -rf / (root)
  /\bsudo\s+rm\s+-rf/,       // sudo rm -rf
  /\b:?\(\)\s*\{.*\}/,       // Fork bomb pattern
  /\bdd\s+if=.*of=\/dev\//,  // dd to device
  /\bmkfs\./,                // Format filesystem
  /\bformat\s+/,             // Windows format
];

/**
 * Execute bash command tool
 */
export const bashExecTool: ToolDefinition<
  {
    command: string;
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  },
  {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  }
> = defineTool({
  name: "bash_exec",
  description: "Execute a bash/shell command",
  category: "bash",
  parameters: z.object({
    command: z.string().describe("Command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
    env: z.record(z.string()).optional().describe("Environment variables"),
  }),
  async execute({ command, cwd, timeout, env }) {
    // Check for dangerous commands
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new ToolError(
          `Potentially dangerous command blocked: ${command.slice(0, 100)}`,
          { tool: "bash_exec" }
        );
      }
    }

    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      const options: ExecaOptions = {
        cwd: cwd ?? process.cwd(),
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        shell: true,
        reject: false,
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const result = await execa(command, options);

      return {
        stdout: truncateOutput(typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "")),
        stderr: truncateOutput(typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "")),
        exitCode: result.exitCode ?? 0,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if ((error as { timedOut?: boolean }).timedOut) {
        throw new TimeoutError(`Command timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: command.slice(0, 100),
        });
      }

      throw new ToolError(
        `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "bash_exec", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Execute bash command in background tool
 */
export const bashBackgroundTool: ToolDefinition<
  {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
  },
  {
    pid: number;
    command: string;
  }
> = defineTool({
  name: "bash_background",
  description: "Execute a command in the background (returns immediately)",
  category: "bash",
  parameters: z.object({
    command: z.string().describe("Command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    env: z.record(z.string()).optional().describe("Environment variables"),
  }),
  async execute({ command, cwd, env }) {
    // Check for dangerous commands
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        throw new ToolError(
          `Potentially dangerous command blocked: ${command.slice(0, 100)}`,
          { tool: "bash_background" }
        );
      }
    }

    try {
      const subprocess = execa(command, {
        cwd: cwd ?? process.cwd(),
        env: { ...process.env, ...env },
        shell: true,
        detached: true,
        stdio: "ignore",
      });

      // Unref to allow parent to exit
      subprocess.unref();

      return {
        pid: subprocess.pid ?? 0,
        command,
      };
    } catch (error) {
      throw new ToolError(
        `Failed to start background command: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "bash_background", cause: error instanceof Error ? error : undefined }
      );
    }
  },
});

/**
 * Check if command exists tool
 */
export const commandExistsTool: ToolDefinition<
  { command: string },
  { exists: boolean; path?: string }
> = defineTool({
  name: "command_exists",
  description: "Check if a command is available in PATH",
  category: "bash",
  parameters: z.object({
    command: z.string().describe("Command name to check"),
  }),
  async execute({ command }) {
    try {
      const whichCommand = process.platform === "win32" ? "where" : "which";
      const result = await execa(whichCommand, [command], {
        reject: false,
      });

      if (result.exitCode === 0 && result.stdout) {
        return {
          exists: true,
          path: result.stdout.trim().split("\n")[0],
        };
      }

      return { exists: false };
    } catch {
      return { exists: false };
    }
  },
});

/**
 * Get environment variable tool
 */
export const getEnvTool: ToolDefinition<
  { name: string },
  { value: string | null; exists: boolean }
> = defineTool({
  name: "get_env",
  description: "Get an environment variable value",
  category: "bash",
  parameters: z.object({
    name: z.string().describe("Environment variable name"),
  }),
  async execute({ name }) {
    const value = process.env[name];
    return {
      value: value ?? null,
      exists: value !== undefined,
    };
  },
});

/**
 * All bash tools
 */
export const bashTools = [
  bashExecTool,
  bashBackgroundTool,
  commandExistsTool,
  getEnvTool,
];

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
