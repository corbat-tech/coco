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
 * Dangerous patterns that apply to the full command string.
 * These look for structural operations (destructive, privilege escalation, etc.)
 * that cannot appear as false positives inside heredoc content.
 */
const DANGEROUS_PATTERNS_FULL: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /\brm\s+-rf\s+\/(?!\w)/, rule: "rm -rf on root filesystem" },
  { pattern: /\bsudo\s+rm\s+-rf/, rule: "sudo rm -rf (destructive with elevated privileges)" },
  { pattern: /\b:?\(\)\s*\{.*\}/, rule: "fork bomb pattern" },
  { pattern: /\bdd\s+if=.*of=\/dev\//, rule: "dd write to device" },
  { pattern: /\bmkfs\./, rule: "filesystem format command" },
  { pattern: /\bformat\s+/, rule: "format command" },
  { pattern: />\s*\/etc\//, rule: "write redirect to /etc/" },
  { pattern: />\s*\/root\//, rule: "write redirect to /root/" },
  { pattern: /\bchmod\s+777/, rule: "overly permissive chmod 777" },
  { pattern: /\bchown\s+root/, rule: "chown to root" },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh/, rule: "curl pipe to shell (untrusted code execution)" },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh/, rule: "wget pipe to shell (untrusted code execution)" },
];

/**
 * Patterns that are only checked against the shell command part (not heredoc body).
 *
 * These are legitimate bash constructs but also appear harmlessly inside code
 * content written via heredocs — e.g. $() in jQuery, `backtick` in Markdown,
 * "source of truth" in comments, eval() in JS.
 * When a heredoc is present we check only the command header line to avoid
 * false positives from file content.
 */
const DANGEROUS_PATTERNS_SHELL_ONLY: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /`[^`]+`/, rule: "backtick command substitution" },
  { pattern: /\$\([^)]+\)/, rule: "$() command substitution" },
  { pattern: /\beval\s+/, rule: "eval command (arbitrary code execution)" },
  { pattern: /\bsource\s+/, rule: "source command (can execute arbitrary scripts)" },
];

/**
 * Extract only the shell command part of a command string, stripping heredoc body.
 *
 * When a heredoc (`<< 'EOF'`) is present the shell does not execute the body —
 * it is treated as literal input data.  Safety patterns that are meaningful in
 * shell context (e.g. `$()`, backticks) must therefore be checked only against
 * the first line (the command header), not the body text, to avoid false positives
 * from file content such as jQuery selectors, Markdown code blocks, or comments.
 *
 * Single-quoted delimiters (`<< 'EOF'`) completely suppress expansion, and
 * double-quoted / unquoted delimiters also do not execute the body as shell.
 */
function getShellCommandPart(command: string): string {
  const firstNewline = command.indexOf("\n");
  if (firstNewline === -1) return command;
  const firstLine = command.slice(0, firstNewline);
  if (/<<-?\s*['"]?\w/.test(firstLine)) {
    return firstLine;
  }
  return command;
}

/**
 * Environment variables safe to expose (whitelist)
 */
const SAFE_ENV_VARS = new Set([
  // System info (non-sensitive)
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "PWD",
  "OLDPWD",
  "HOSTNAME",
  "EDITOR",
  "VISUAL",
  // Node.js
  "NODE_ENV",
  "NODE_PATH",
  "NODE_OPTIONS",
  "NPM_CONFIG_REGISTRY",
  // Project-specific (safe)
  "COCO_CONFIG_PATH",
  "COCO_LOG_LEVEL",
  "COCO_DEBUG",
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TRAVIS",
  // XDG
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);

/**
 * Sensitive env var patterns (blocklist)
 */
const SENSITIVE_ENV_PATTERNS = [
  /^.*_KEY$/i,
  /^.*_SECRET$/i,
  /^.*_TOKEN$/i,
  /^.*_PASSWORD$/i,
  /^.*_CREDENTIALS$/i,
  /^.*_API_KEY$/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GOOGLE_/i,
  /^GITHUB_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^DATABASE_URL$/i,
  /^REDIS_URL$/i,
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
  description: `Execute a bash/shell command with safety controls.

Examples:
- List files: { "command": "ls -la" }
- Run npm script: { "command": "npm run build" }
- Check disk space: { "command": "df -h" }
- Find process: { "command": "ps aux | grep node" }`,
  category: "bash",
  parameters: z.object({
    command: z.string().describe("Command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
    env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
  }),
  async execute({ command, cwd, timeout, env }) {
    // Check for dangerous commands.
    // DANGEROUS_PATTERNS_FULL are checked against the whole command string.
    // DANGEROUS_PATTERNS_SHELL_ONLY are checked only against the shell command
    // header (first line) to avoid false positives from heredoc body content
    // (e.g. jQuery $(), backticks in Markdown, "source of truth" comments).
    const shellPart = getShellCommandPart(command);
    for (const { pattern, rule } of DANGEROUS_PATTERNS_FULL) {
      if (pattern.test(command)) {
        throw new ToolError(
          `Command blocked by safety rule: "${rule}". Rewrite the command to avoid this pattern, or use a safer alternative.`,
          { tool: "bash_exec" },
        );
      }
    }
    for (const { pattern, rule } of DANGEROUS_PATTERNS_SHELL_ONLY) {
      if (pattern.test(shellPart)) {
        throw new ToolError(
          `Command blocked by safety rule: "${rule}". Rewrite the command to avoid this pattern, or use a safer alternative.`,
          { tool: "bash_exec" },
        );
      }
    }

    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

    // Import heartbeat dynamically to avoid circular dependencies
    const { CommandHeartbeat } = await import("./utils/heartbeat.js");

    const heartbeat = new CommandHeartbeat({
      onUpdate: (stats) => {
        if (stats.elapsedSeconds > 10) {
          // Only show heartbeat for commands running >10s
          process.stderr.write(`\r⏱️  ${stats.elapsedSeconds}s elapsed`);
        }
      },
      onWarn: (message) => {
        process.stderr.write(`\n${message}\n`);
      },
    });

    try {
      heartbeat.start();

      const options: ExecaOptions = {
        cwd: cwd ?? process.cwd(),
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        shell: true,
        reject: false,
        buffer: false, // Enable streaming
        maxBuffer: MAX_OUTPUT_SIZE,
      };

      const subprocess = execa(command, options);

      let stdoutBuffer = "";
      let stderrBuffer = "";

      // Stream stdout in real-time
      subprocess.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuffer += text;
        process.stdout.write(text);
        heartbeat.activity();
      });

      // Stream stderr in real-time
      subprocess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuffer += text;
        process.stderr.write(text);
        heartbeat.activity();
      });

      const result = await subprocess;

      return {
        stdout: truncateOutput(stdoutBuffer),
        stderr: truncateOutput(stderrBuffer),
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
        { tool: "bash_exec", cause: error instanceof Error ? error : undefined },
      );
    } finally {
      heartbeat.stop();
      // Clear the heartbeat line if it was shown
      process.stderr.write("\r                                        \r");
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
  description: `Execute a command in the background (returns immediately with PID).

Examples:
- Start dev server: { "command": "npm run dev" }
- Run watcher: { "command": "npx nodemon src/index.ts" }
- Start database: { "command": "docker-compose up" }`,
  category: "bash",
  parameters: z.object({
    command: z.string().describe("Command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
  }),
  async execute({ command, cwd, env }) {
    // Check for dangerous commands (same two-pass logic as bashExecTool).
    const shellPart = getShellCommandPart(command);
    for (const { pattern, rule } of DANGEROUS_PATTERNS_FULL) {
      if (pattern.test(command)) {
        throw new ToolError(
          `Command blocked by safety rule: "${rule}". Rewrite the command to avoid this pattern, or use a safer alternative.`,
          { tool: "bash_background" },
        );
      }
    }
    for (const { pattern, rule } of DANGEROUS_PATTERNS_SHELL_ONLY) {
      if (pattern.test(shellPart)) {
        throw new ToolError(
          `Command blocked by safety rule: "${rule}". Rewrite the command to avoid this pattern, or use a safer alternative.`,
          { tool: "bash_background" },
        );
      }
    }

    try {
      // Create filtered environment for background process (security)
      const filteredEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && isEnvVarSafe(key)) {
          filteredEnv[key] = value;
        }
      }

      const subprocess = execa(command, {
        cwd: cwd ?? process.cwd(),
        env: { ...filteredEnv, ...env },
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
        { tool: "bash_background", cause: error instanceof Error ? error : undefined },
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
  description: `Check if a command is available in PATH.

Examples:
- Check node: { "command": "node" } → { "exists": true, "path": "/usr/local/bin/node" }
- Check git: { "command": "git" }
- Check docker: { "command": "docker" }`,
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
 * Check if environment variable is safe to expose
 */
function isEnvVarSafe(name: string): boolean {
  // Check whitelist first
  if (SAFE_ENV_VARS.has(name)) {
    return true;
  }
  // Check against sensitive patterns
  for (const pattern of SENSITIVE_ENV_PATTERNS) {
    if (pattern.test(name)) {
      return false;
    }
  }
  // Default: allow non-sensitive looking vars
  return true;
}

/**
 * Get environment variable tool (with security filtering)
 */
export const getEnvTool: ToolDefinition<
  { name: string },
  { value: string | null; exists: boolean; blocked?: boolean }
> = defineTool({
  name: "get_env",
  description: `Get an environment variable value (sensitive variables like API keys are blocked for security).

Examples:
- Get HOME: { "name": "HOME" } → { "value": "/home/user", "exists": true }
- Get NODE_ENV: { "name": "NODE_ENV" } → { "value": "development", "exists": true }
- Blocked var: { "name": "OPENAI_API_KEY" } → { "value": null, "exists": true, "blocked": true }`,
  category: "bash",
  parameters: z.object({
    name: z.string().describe("Environment variable name"),
  }),
  async execute({ name }) {
    // Security check: block sensitive environment variables
    if (!isEnvVarSafe(name)) {
      return {
        value: null,
        exists: process.env[name] !== undefined,
        blocked: true,
      };
    }

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
export const bashTools = [bashExecTool, bashBackgroundTool, commandExistsTool, getEnvTool];

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
