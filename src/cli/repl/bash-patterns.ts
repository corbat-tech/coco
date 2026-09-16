import { createHash } from "node:crypto";

/**
 * Command labels are for display and legacy configuration diagnostics only.
 * Execution authority uses exact invocation fingerprints below.
 */

/** Commands that have meaningful subcommands worth capturing */
const SUBCOMMAND_TOOLS = new Set([
  // Version control
  "git",
  "gh",
  // Package managers
  "npm",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
  "brew",
  "apt",
  "apt-get",
  // JS/TS runtimes with subcommands
  "bun",
  "deno",
  // Build tools
  "docker",
  "docker-compose",
  "cargo",
  "go",
  "gradle",
  "./gradlew",
  "mvn",
  "./mvnw",
  // Cloud & infra
  "kubectl",
  "aws",
]);

/** Commands where 2 subcommand levels are meaningful (noun + verb structure) */
const DEEP_SUBCOMMAND_TOOLS = new Set(["gh", "aws"]);

/**
 * Interpreter commands where specific flags enable inline code execution.
 * These flags are security-sensitive because a prompt injection can use them
 * to run arbitrary code (e.g., `python -c "import os; os.system('curl ...')"`)
 *
 * When detected, the flag is captured in the pattern:
 *   "python -c 'code'" → "bash:python:-c"
 *   "node -e 'code'"   → "bash:node:-e"
 */
const INTERPRETER_DANGEROUS_FLAGS: Record<string, Set<string>> = {
  python: new Set(["-c"]),
  python3: new Set(["-c"]),
  node: new Set(["-e", "--eval", "-p", "--print"]),
  ruby: new Set(["-e"]),
  perl: new Set(["-e"]),
  bun: new Set(["-e", "--eval"]),
};

/**
 * Extract a display label from a bash command string (never an authorization).
 *
 * Produces patterns like "bash:git:commit" or "bash:curl".
 * For tools with known subcommands, captures the subcommand.
 * For everything else, just captures the base command.
 */
export function extractBashPattern(command: string): string {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return "bash:unknown";

  let idx = 0;
  const parts: string[] = ["bash"];

  // Handle sudo prefix
  if (tokens[idx]?.toLowerCase() === "sudo") {
    parts.push("sudo");
    idx++;
    // sudo alone → "bash:sudo"
    if (idx >= tokens.length) return parts.join(":");
  }

  // Base command
  const baseCmd = tokens[idx]?.toLowerCase();
  if (!baseCmd) return parts.join(":");
  parts.push(baseCmd);
  idx++;

  // Check for subcommand or dangerous execution flag
  if (SUBCOMMAND_TOOLS.has(baseCmd)) {
    const maxDepth = DEEP_SUBCOMMAND_TOOLS.has(baseCmd) ? 2 : 1;
    let depth = 0;
    while (idx < tokens.length && depth < maxDepth) {
      const nextToken = tokens[idx];
      if (!nextToken || nextToken.startsWith("-")) break;
      parts.push(nextToken.toLowerCase());
      idx++;
      depth++;
    }
    // Fallback: if no subcommand was captured (e.g., "bun -e"), check for dangerous flags
    if (depth === 0 && idx < tokens.length) {
      const nextToken = tokens[idx];
      if (nextToken && INTERPRETER_DANGEROUS_FLAGS[baseCmd]?.has(nextToken)) {
        parts.push(nextToken.toLowerCase());
      }
    }
  } else if (idx < tokens.length) {
    const nextToken = tokens[idx];
    if (nextToken && INTERPRETER_DANGEROUS_FLAGS[baseCmd]?.has(nextToken)) {
      // Dangerous execution flag for interpreters (e.g., python -c, node -e)
      // Captured separately so "bash:python" (safe) ≠ "bash:python:-c" (risky)
      parts.push(nextToken.toLowerCase());
    }
  }

  return parts.join(":");
}

/**
 * Bind shell approval to the complete invocation, including cwd/environment.
 * Legacy command-prefix grants intentionally do not match these fingerprints.
 * Non-shell tools retain their existing tool-level grants.
 */
export function getTrustPattern(toolName: string, input?: Record<string, unknown>): string {
  if (toolName === "bash_exec" || toolName === "bash_background") {
    const digest = createHash("sha256").update(JSON.stringify({ toolName, input })).digest("hex");
    return `bash:exact:${digest}`;
  }
  return toolName;
}

/** Compatibility helper for an exact foreground command with no extra options. */
export function isBashCommandTrusted(command: string, trustedPatterns: Set<string>): boolean {
  return trustedPatterns.has(getTrustPattern("bash_exec", { command }));
}
