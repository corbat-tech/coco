/**
 * COCO Mode - Quality-driven iterative development
 *
 * When enabled, the agent automatically:
 * 1. Generates code + tests
 * 2. Runs tests
 * 3. Self-reviews with 12-dimension quality scoring
 * 4. Iterates until quality converges (score delta < 2)
 *
 * Toggle with /coco command or --coco CLI flag.
 */

import chalk from "chalk";
import fs from "node:fs/promises";
import { CONFIG_PATHS } from "../../config/paths.js";

/**
 * COCO mode state
 * Default: enabled for better quality (users can disable with /coco off)
 */
let cocoModeEnabled = true;

/**
 * Whether the contextual hint has been shown this session
 */
let hintShown = false;

/**
 * Check if COCO mode is enabled
 */
export function isCocoMode(): boolean {
  return cocoModeEnabled;
}

/**
 * Set COCO mode state
 */
export function setCocoMode(enabled: boolean): void {
  cocoModeEnabled = enabled;
}

/**
 * Toggle COCO mode, returns new state
 */
export function toggleCocoMode(): boolean {
  cocoModeEnabled = !cocoModeEnabled;
  return cocoModeEnabled;
}

/**
 * Check if contextual hint was already shown
 */
export function wasHintShown(): boolean {
  return hintShown;
}

/**
 * Mark contextual hint as shown
 */
export function markHintShown(): void {
  hintShown = true;
}

/**
 * Determine if a user prompt looks like a feature/implementation request
 * (vs a simple question or short command)
 */
export function looksLikeFeatureRequest(input: string): boolean {
  const trimmed = input.trim();

  // Too short to be a feature request
  if (trimmed.length < 20) return false;

  // Questions are usually not feature requests
  if (trimmed.endsWith("?") && trimmed.length < 80) return false;

  // Check for implementation-like keywords
  const featureKeywords = [
    /\bimplement/i,
    /\bcreate\b/i,
    /\bbuild\b/i,
    /\badd\b.*\b(feature|function|component|endpoint|service|module|class)/i,
    /\brefactor/i,
    /\bmigrate/i,
    /\bsetup\b/i,
    /\bintegrate/i,
    /\bwrite\b.*\b(code|function|test|module)/i,
    /\bdevelop/i,
    /\bdesign\b/i,
    /\bfix\b.*\b(bug|issue|error|problem)/i,
    /\bupdate\b.*\b(function|component|service|module)/i,
    /\bgenerate\b/i,
    /\bconvert\b/i,
  ];

  return featureKeywords.some((re) => re.test(trimmed));
}

/**
 * Format the COCO mode status for display in prompt
 */
export function formatCocoModeIndicator(): string {
  if (cocoModeEnabled) {
    return chalk.magenta("[coco]");
  }
  return "";
}

/**
 * Format the contextual hint shown on first feature-like prompt
 */
export function formatCocoHint(): string {
  return (
    chalk.dim("  tip: ") +
    chalk.magenta("/coco") +
    chalk.dim(" enables auto-test & iterate until quality converges")
  );
}

/**
 * Format quality convergence result for display after COCO mode completion
 */
export function formatQualityResult(result: CocoQualityResult): string {
  const lines: string[] = [];

  // Score progression bar
  const scores = result.scoreHistory;
  const progressStr = scores.map((s) => String(s)).join(" → ");
  const convergedLabel = result.converged
    ? chalk.green("converged")
    : chalk.yellow("max iterations");

  lines.push("");
  lines.push(
    chalk.magenta("── Quality: ") +
      chalk.white(progressStr) +
      chalk.dim(` (${convergedLabel})`) +
      chalk.magenta(" ──"),
  );

  // Stats line
  const parts: string[] = [];

  if (result.testsPassed !== undefined && result.testsTotal !== undefined) {
    const testsColor = result.testsPassed === result.testsTotal ? chalk.green : chalk.yellow;
    parts.push(testsColor(`Tests: ${result.testsPassed}/${result.testsTotal}`));
  }

  if (result.coverage !== undefined) {
    const covColor = result.coverage >= 80 ? chalk.green : chalk.yellow;
    parts.push(covColor(`Coverage: ${result.coverage}%`));
  }

  if (result.securityScore !== undefined) {
    const secColor = result.securityScore === 100 ? chalk.green : chalk.red;
    parts.push(secColor(`Security: ${result.securityScore}`));
  }

  parts.push(chalk.dim(`Iterations: ${result.iterations}`));

  if (result.durationMs !== undefined) {
    const secs = (result.durationMs / 1000).toFixed(1);
    parts.push(chalk.dim(`Time: ${secs}s`));
  }

  lines.push("   " + parts.join("  "));
  lines.push("");

  return lines.join("\n");
}

/**
 * Result from a COCO mode quality iteration cycle
 */
export interface CocoQualityResult {
  converged: boolean;
  scoreHistory: number[];
  finalScore: number;
  iterations: number;
  testsPassed?: number;
  testsTotal?: number;
  coverage?: number;
  securityScore?: number;
  durationMs?: number;
}

/**
 * Load COCO mode preference from config
 */
export async function loadCocoModePreference(): Promise<boolean> {
  try {
    const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
    const config = JSON.parse(content);
    if (typeof config.cocoMode === "boolean") {
      cocoModeEnabled = config.cocoMode;
      return config.cocoMode;
    }
  } catch {
    // No config or parse error - default is ON
  }
  return true; // Default to enabled
}

/**
 * Save COCO mode preference to config
 */
export async function saveCocoModePreference(enabled: boolean): Promise<void> {
  try {
    let config: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(CONFIG_PATHS.config, "utf-8");
      config = JSON.parse(content);
    } catch {
      // File doesn't exist yet
    }
    config.cocoMode = enabled;
    await fs.writeFile(CONFIG_PATHS.config, JSON.stringify(config, null, 2) + "\n");
  } catch {
    // Silently fail
  }
}

/**
 * Parse COCO quality report from agent response content
 */
export function parseCocoQualityReport(content: string): CocoQualityResult | null {
  const marker = "COCO_QUALITY_REPORT";
  const idx = content.indexOf(marker);
  if (idx === -1) return null;

  const block = content.slice(idx);

  const getField = (name: string): string | undefined => {
    const match = block.match(new RegExp(`${name}:\\s*(.+)`));
    return match?.[1]?.trim();
  };

  const scoreHistoryRaw = getField("score_history");
  if (!scoreHistoryRaw) return null;

  // Parse [72, 84, 87, 88]
  const scores = scoreHistoryRaw
    .replace(/[[\]]/g, "")
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  if (scores.length === 0) return null;

  const testsPassed = parseInt(getField("tests_passed") ?? "", 10);
  const testsTotal = parseInt(getField("tests_total") ?? "", 10);
  const coverage = parseInt(getField("coverage") ?? "", 10);
  const security = parseInt(getField("security") ?? "", 10);
  const iterations = parseInt(getField("iterations") ?? "", 10) || scores.length;
  const converged = getField("converged") === "true";

  return {
    converged,
    scoreHistory: scores,
    finalScore: scores[scores.length - 1] ?? 0,
    iterations,
    testsPassed: isNaN(testsPassed) ? undefined : testsPassed,
    testsTotal: isNaN(testsTotal) ? undefined : testsTotal,
    coverage: isNaN(coverage) ? undefined : coverage,
    securityScore: isNaN(security) ? undefined : security,
  };
}

/**
 * Build the supplemental system prompt for COCO mode
 * This instructs the LLM to follow the quality iteration pattern
 */
export function getCocoModeSystemPrompt(): string {
  return `
## COCO Quality Mode (ACTIVE)

You are operating in COCO quality mode. After implementing code changes, you MUST follow this iteration cycle:

1. **Implement** the requested changes (code + tests)
2. **Run tests** using the run_tests or bash_exec tool
3. **Self-review**: Analyze your code against these 12 quality dimensions:
   - Correctness, Completeness, Robustness, Readability
   - Maintainability, Complexity, Duplication, Test Coverage
   - Test Quality, Security, Documentation, Style
4. **Score** your implementation 0-100 for each dimension
5. **If issues found**: Fix them and go back to step 2
6. **If quality is good** (overall ≥ 85 and improving < 2 points): Stop and report

After completing the cycle, output a quality summary in this exact format:

\`\`\`
COCO_QUALITY_REPORT
score_history: [first_score, ..., final_score]
tests_passed: X
tests_total: Y
coverage: Z
security: 100
iterations: N
converged: true|false
\`\`\`

Key rules:
- Always write tests alongside code
- Run tests after every change
- Minimum 2 iterations before declaring convergence
- Maximum 10 iterations
- Fix critical issues before moving on
- Report honestly - don't inflate scores`;
}
