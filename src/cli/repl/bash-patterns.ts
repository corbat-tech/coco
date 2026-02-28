/**
 * Bash command pattern extraction for granular trust
 *
 * Instead of trusting ALL bash commands when user approves one,
 * we extract subcommand-level patterns for precise trust control.
 *
 * Examples:
 * - "git commit -m 'foo'" -> "bash:git:commit"
 * - "curl google.com"     -> "bash:curl"
 * - "npm install lodash"  -> "bash:npm:install"
 * - "sudo git push"       -> "bash:sudo:git:push"
 * - "ls -la"              -> "bash:ls"
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
 * Extract a trust pattern from a bash command string.
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
 * Get the trust pattern for a tool call.
 *
 * For bash_exec/bash_background: extracts subcommand pattern.
 * For all other tools: returns the tool name as-is.
 */
export function getTrustPattern(toolName: string, input?: Record<string, unknown>): string {
  if (
    (toolName === "bash_exec" || toolName === "bash_background") &&
    typeof input?.command === "string"
  ) {
    return extractBashPattern(input.command);
  }
  return toolName;
}

/**
 * Check if a bash command matches a trusted pattern.
 *
 * SECURITY: Only exact match. Trusting "bash:git" does NOT
 * auto-approve "bash:git:push". Each subcommand must be
 * trusted independently.
 */
export function isBashCommandTrusted(command: string, trustedPatterns: Set<string>): boolean {
  const pattern = extractBashPattern(command);
  return trustedPatterns.has(pattern);
}
