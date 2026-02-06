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
  "brew",
  "apt",
  "apt-get",
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

  // Check for subcommand (only for known tools)
  if (SUBCOMMAND_TOOLS.has(baseCmd) && idx < tokens.length) {
    const subcmd = tokens[idx];
    // Only treat as subcommand if it doesn't start with - (that's a flag)
    if (subcmd && !subcmd.startsWith("-")) {
      parts.push(subcmd.toLowerCase());
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
