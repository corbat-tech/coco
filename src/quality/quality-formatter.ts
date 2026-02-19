/**
 * Quality Formatter
 *
 * Renders `QualityEvaluation` results as human-readable terminal output.
 * All output is plain ASCII — no chalk/ANSI imports so the formatter can be
 * used in test snapshots and in CI environments without color support.
 *
 * Usage:
 *   const formatter = new QualityFormatter();
 *   console.log(formatter.formatFull(evaluation));
 */

import type {
  QualityEvaluation,
  QualityDimensions,
  QualityIssue,
  QualitySuggestion,
} from "./types.js";
import { DIMENSION_LABELS, DIMENSION_ORDER } from "./dimension-constants.js";

const BAR_WIDTH = 20;

// ──────────────────────────────────────────────────────────────────────────────
// QualityFormatter
// ──────────────────────────────────────────────────────────────────────────────

export class QualityFormatter {
  /**
   * One-line summary: overall score + pass/fail status.
   * @example "Overall: 87/100 [PASS]"
   */
  formatSummary(evaluation: QualityEvaluation): string {
    const overall = Math.round(evaluation.scores.overall);
    const status = evaluation.meetsMinimum ? "PASS" : "FAIL";
    const icon = evaluation.meetsMinimum ? "✓" : "✗";
    return `${icon} Overall: ${overall}/100 [${status}]`;
  }

  /**
   * Box-style dimensions table with score bar.
   *
   * Example:
   * ╭─────────────────── Quality Report ───────────────────╮
   * │  Dimension        Score  ████████████████░░░░  Status │
   * ├──────────────────────────────────────────────────────┤
   * │  Correctness        92  ██████████████████░░  ✓      │
   * ...
   * ╰──────────────────────────────────────────────────────╯
   */
  formatTable(evaluation: QualityEvaluation): string {
    const { dimensions } = evaluation.scores;
    const labelWidth = 15; // widest label: "Maintainability" = 15 chars

    const header = "─── Quality Report ───";
    const topBorder = `╭${header}${"─".repeat(45 - header.length)}╮`;
    const colHeader = `│  ${"Dimension".padEnd(labelWidth)}  Score  ${"Bar".padEnd(BAR_WIDTH + 2)} Status │`;
    const divider = `├${"─".repeat(topBorder.length - 2)}┤`;
    const bottomBorder = `╰${"─".repeat(topBorder.length - 2)}╯`;

    const rows: string[] = [topBorder, colHeader, divider];

    for (const key of DIMENSION_ORDER) {
      const score = dimensions[key] ?? 0;
      rows.push(this.formatDimensionRow(key, score, labelWidth));
    }

    const overall = Math.round(evaluation.scores.overall);
    const overallBar = this.makeBar(overall);
    const overallIcon = evaluation.meetsMinimum ? "✓" : "✗";
    rows.push(divider);
    rows.push(
      `│  ${"Overall".padEnd(labelWidth)}   ${String(overall).padStart(3)}  ${overallBar}  ${overallIcon}      │`,
    );
    rows.push(bottomBorder);

    return rows.join("\n");
  }

  /**
   * Formatted issues list.
   * Returns a single "No issues found." line when the list is empty.
   */
  formatIssues(evaluation: QualityEvaluation): string {
    if (evaluation.issues.length === 0) return "No issues found.";

    const lines: string[] = [`Issues (${evaluation.issues.length}):`];
    for (const issue of evaluation.issues) {
      lines.push(this.formatIssue(issue));
    }
    return lines.join("\n");
  }

  /**
   * Formatted suggestions list (top 5 by priority, then impact).
   */
  formatSuggestions(evaluation: QualityEvaluation): string {
    if (evaluation.suggestions.length === 0) return "No suggestions.";

    const sorted = [...evaluation.suggestions]
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
        return pd !== 0 ? pd : b.estimatedImpact - a.estimatedImpact;
      })
      .slice(0, 5);

    const lines: string[] = [`Suggestions (showing top ${sorted.length}):`];
    for (const s of sorted) {
      lines.push(this.formatSuggestion(s));
    }
    return lines.join("\n");
  }

  /**
   * Full report: table + issues + suggestions.
   */
  formatFull(evaluation: QualityEvaluation): string {
    const parts: string[] = [this.formatTable(evaluation), ""];

    if (evaluation.issues.length > 0) {
      parts.push(this.formatIssues(evaluation));
      parts.push("");
    }

    if (evaluation.suggestions.length > 0) {
      parts.push(this.formatSuggestions(evaluation));
    }

    return parts.join("\n").trimEnd();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private formatDimensionRow(
    key: keyof QualityDimensions,
    score: number,
    labelWidth: number,
  ): string {
    const label = DIMENSION_LABELS[key];
    const rounded = Math.round(score);
    const bar = this.makeBar(score);
    const icon = score >= 90 ? "✓" : score >= 75 ? "~" : "✗";
    return `│  ${label.padEnd(labelWidth)}   ${String(rounded).padStart(3)}  ${bar}  ${icon}      │`;
  }

  private makeBar(score: number): string {
    const filled = Math.round((score / 100) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, empty));
  }

  private formatIssue(issue: QualityIssue): string {
    const severityIcon =
      issue.severity === "critical" ? "!!" : issue.severity === "major" ? " !" : "  ";
    const location = issue.file
      ? ` [${issue.file}${issue.line !== undefined ? `:${issue.line}` : ""}]`
      : "";
    const lines = [`  ${severityIcon} [${issue.dimension}] ${issue.message}${location}`];
    if (issue.suggestion) {
      lines.push(`      → ${issue.suggestion}`);
    }
    return lines.join("\n");
  }

  private formatSuggestion(s: QualitySuggestion): string {
    const priorityIcon = s.priority === "high" ? "!!" : s.priority === "medium" ? " !" : "  ";
    return `  ${priorityIcon} [${s.dimension}] ${s.description} (+${s.estimatedImpact} pts)`;
  }
}

/** Shared singleton formatter */
export const qualityFormatter = new QualityFormatter();
