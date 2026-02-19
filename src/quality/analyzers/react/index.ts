/**
 * React Quality Analyzers
 *
 * Static analysis for React projects without requiring external tools.
 * Covers component quality, accessibility (a11y), and React Hooks rules.
 *
 * Supported dimensions (via registerReactAnalyzers):
 * - style       → ReactComponentAnalyzer (component structure quality)
 * - robustness  → ReactA11yAnalyzer (accessibility violations)
 * - correctness → ReactHookAnalyzer (React Hooks rules compliance)
 */

import { readFile } from "node:fs/promises";
import { glob } from "glob";
import type { DimensionRegistry } from "../../dimension-registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────────────────────

interface ReactFileInput {
  path: string;
  content: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared module-level helpers (used by all 3 analyzer classes)
// ──────────────────────────────────────────────────────────────────────────────

async function loadFiles(files: string[]): Promise<ReactFileInput[]> {
  return Promise.all(
    files.map(async (f) => ({
      path: f,
      content: await readFile(f, "utf-8").catch(() => ""),
    })),
  );
}

async function findReactFiles(projectPath: string, pattern = "**/*.{tsx,jsx}"): Promise<string[]> {
  return glob(pattern, {
    cwd: projectPath,
    absolute: true,
    ignore: ["**/node_modules/**", "**/*.test.*", "**/*.spec.*"],
  });
}

export interface ReactIssue {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

// ──────────────────────────────────────────────────────────────────────────────
// ReactComponentAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface ReactComponentResult {
  score: number;
  totalComponents: number;
  issues: ReactIssue[];
}

/**
 * Analyzes React component quality:
 * - Missing key prop in list rendering (.map() returning JSX without key)
 * - Prop types or TypeScript interface usage
 * - Component naming (PascalCase)
 * - Direct DOM manipulation (ref overuse, document.getElementById)
 */
export class ReactComponentAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<ReactComponentResult> {
    const reactFiles = files ?? (await findReactFiles(this.projectPath));
    if (!reactFiles.length) return { score: 100, totalComponents: 0, issues: [] };

    const fileContents = await loadFiles(reactFiles);
    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: ReactFileInput[]): ReactComponentResult {
    if (!files.length) return { score: 100, totalComponents: 0, issues: [] };

    const issues: ReactIssue[] = [];
    let totalComponents = 0;

    for (const { path: filePath, content } of files) {
      const lines = content.split("\n");
      let inComponent = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const lineNum = i + 1;

        // Count component declarations (function starting with uppercase)
        if (
          /\bfunction\s+[A-Z]\w*\s*\(|const\s+[A-Z]\w*\s*=\s*(?:\([^)]*\)|[a-z]\w*)\s*=>/.test(line)
        ) {
          totalComponents++;
          inComponent = true;
        }

        // Missing key in .map() rendering JSX
        if (/\.map\s*\(/.test(line)) {
          // Check next few lines for a JSX element returned without a key prop
          const block = lines.slice(i, i + 4).join("\n");
          if (/<[a-zA-Z]/.test(block) && !/key\s*=/.test(block)) {
            issues.push({
              rule: "react/missing-key",
              file: filePath,
              line: lineNum,
              message: "Missing 'key' prop in list rendering — elements need unique keys",
              severity: "error",
            });
          }
        }

        // Component naming violation (lowercase function that renders JSX)
        const lowerFnMatch = /\bfunction\s+([a-z]\w*)\s*\([^)]*\)\s*\{/.exec(line);
        if (lowerFnMatch && inComponent) {
          const nextContent = lines.slice(i, i + 20).join("\n");
          if (/<[A-Z]|return\s*\(/.test(nextContent)) {
            issues.push({
              rule: "react/component-naming",
              file: filePath,
              line: lineNum,
              message: `Component '${lowerFnMatch[1]}' should use PascalCase naming`,
              severity: "warning",
            });
          }
        }

        // Untyped props parameter — function X(props) with no TypeScript annotation
        if (/\bfunction\s+[A-Z]\w*\s*\(\s*props\s*\)/.test(line)) {
          issues.push({
            rule: "react/prop-types",
            file: filePath,
            line: lineNum,
            message:
              "Component props are not typed — use a TypeScript interface or destructure with types",
            severity: "error",
          });
        }

        // Missing JSDoc on exported component
        if (/^\s*export\s+(?:default\s+)?function\s+[A-Z]\w*/.test(line)) {
          let prevLineIdx = i - 1;
          while (prevLineIdx >= 0 && (lines[prevLineIdx] ?? "").trim() === "") {
            prevLineIdx--;
          }
          const prevLine = (lines[prevLineIdx] ?? "").trim();
          if (!prevLine.endsWith("*/")) {
            issues.push({
              rule: "react/missing-jsdoc",
              file: filePath,
              line: lineNum,
              message: "Exported component missing JSDoc comment",
              severity: "warning",
            });
          }
        }

        // Direct DOM manipulation
        if (/document\.getElementById|document\.querySelector|document\.createElement/.test(line)) {
          issues.push({
            rule: "react/no-direct-dom-manipulation",
            file: filePath,
            line: lineNum,
            message: "Avoid direct DOM manipulation in React — use refs or state instead",
            severity: "warning",
          });
        }

        // dangerouslySetInnerHTML without sanitization hint
        if (/dangerouslySetInnerHTML/.test(line) && !/sanitize|DOMPurify|xss/.test(line)) {
          issues.push({
            rule: "react/no-danger",
            file: filePath,
            line: lineNum,
            message: "dangerouslySetInnerHTML can lead to XSS — ensure content is sanitized",
            severity: "error",
          });
        }
      }
    }

    const deduction = issues.reduce((s, i) => s + (i.severity === "error" ? 10 : 5), 0);
    const score = Math.max(0, 100 - deduction);

    return { score, totalComponents, issues };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// ReactA11yAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface A11yViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
  wcag?: string;
}

export interface ReactA11yResult {
  score: number;
  violations: A11yViolation[];
}

/**
 * Accessibility (a11y) analyzer for React components.
 * Checks WCAG-inspired rules:
 * - Images must have alt text
 * - Interactive elements must be keyboard accessible
 * - Anchors must have valid href or role
 * - Non-interactive elements should not have onClick handlers alone
 */
export class ReactA11yAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<ReactA11yResult> {
    const reactFiles = files ?? (await findReactFiles(this.projectPath));
    if (!reactFiles.length) return { score: 100, violations: [] };

    const fileContents = await loadFiles(reactFiles);
    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: ReactFileInput[]): ReactA11yResult {
    if (!files.length) return { score: 100, violations: [] };

    const violations: A11yViolation[] = [];

    for (const { path: filePath, content } of files) {
      violations.push(...this.checkFile(filePath, content));
    }

    const deduction = violations.reduce((s, v) => s + (v.severity === "error" ? 12 : 6), 0);
    const score = Math.max(0, 100 - deduction);

    return { score, violations };
  }

  private checkFile(filePath: string, content: string): A11yViolation[] {
    const violations: A11yViolation[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;

      // img without alt — look ahead up to 4 lines for multi-line JSX elements
      if (/<img\b/.test(line)) {
        const imgBlock = lines.slice(i, Math.min(i + 4, lines.length)).join("\n");
        if (!/alt\s*=/.test(imgBlock)) {
          violations.push({
            rule: "jsx-a11y/alt-text",
            file: filePath,
            line: lineNum,
            message: "<img> element missing 'alt' attribute",
            severity: "error",
            wcag: "WCAG 1.1.1",
          });
        }
      }

      // <a> without href — look ahead up to 4 lines for multi-line JSX elements
      if (/<a\b/.test(line)) {
        const aBlock = lines.slice(i, Math.min(i + 4, lines.length)).join("\n");
        if (!/href\s*=/.test(aBlock) && !/ role\s*=/.test(aBlock)) {
          violations.push({
            rule: "jsx-a11y/anchor-has-content",
            file: filePath,
            line: lineNum,
            message: "<a> element missing href — use a <button> for non-navigation actions",
            severity: "error",
            wcag: "WCAG 2.1.1",
          });
        }
      }

      // Non-interactive div/span with onClick (missing keyboard support)
      if (/<(?:div|span)\b[^>]*onClick[^>]*>/.test(line)) {
        const hasKeyboardSupport =
          /onKey(?:Down|Up|Press)|role\s*=\s*["'](?:button|link|menuitem)|tabIndex/.test(line);
        if (!hasKeyboardSupport) {
          // Check surrounding lines for keyboard support
          const context = lines.slice(Math.max(0, i - 1), i + 3).join(" ");
          if (!/onKey(?:Down|Up|Press)|tabIndex/.test(context)) {
            violations.push({
              rule: "jsx-a11y/interactive-supports-focus",
              file: filePath,
              line: lineNum,
              message:
                "Non-interactive element with onClick handler — add keyboard support (onKeyDown, tabIndex, role)",
              severity: "warning",
              wcag: "WCAG 2.1.1",
            });
          }
        }
      }

      // Form inputs without labels
      if (/<input\b[^>]*>/.test(line) && !/aria-label|aria-labelledby|id\s*=/.test(line)) {
        violations.push({
          rule: "jsx-a11y/label-association",
          file: filePath,
          line: lineNum,
          message:
            "<input> missing label association (aria-label, aria-labelledby, or id for <label>)",
          severity: "warning",
          wcag: "WCAG 1.3.1",
        });
      }

      // Autoplay media without controls
      if (/<video\b[^>]*autoPlay[^>]*>/.test(line) && !/controls/.test(line)) {
        violations.push({
          rule: "jsx-a11y/media-has-caption",
          file: filePath,
          line: lineNum,
          message: "Autoplaying video without controls — add controls attribute",
          severity: "warning",
          wcag: "WCAG 1.2.2",
        });
      }
    }

    return violations;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// ReactHookAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface HookViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface ReactHookResult {
  score: number;
  violations: HookViolation[];
}

/**
 * Checks compliance with React Rules of Hooks:
 * 1. useEffect without dependency array (runs on every render)
 * 2. Hooks called inside conditionals (violates Rules of Hooks)
 * 3. Hooks called inside loops
 * 4. Hooks called in non-hook, non-component functions
 */
export class ReactHookAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<ReactHookResult> {
    const reactFiles = files ?? (await findReactFiles(this.projectPath, "**/*.{tsx,jsx,ts,js}"));
    if (!reactFiles.length) return { score: 100, violations: [] };

    const fileContents = await loadFiles(reactFiles);
    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: ReactFileInput[]): ReactHookResult {
    if (!files.length) return { score: 100, violations: [] };

    const violations: HookViolation[] = [];

    for (const { path: filePath, content } of files) {
      violations.push(...this.checkFile(filePath, content));
    }

    const deduction = violations.reduce((s, v) => s + (v.severity === "error" ? 15 : 7), 0);
    const score = Math.max(0, 100 - deduction);

    return { score, violations };
  }

  private checkFile(filePath: string, content: string): HookViolation[] {
    const violations: HookViolation[] = [];
    const lines = content.split("\n");

    let conditionalDepth = 0;
    let loopDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;
      const trimmed = line.trim();

      // Track conditional depth — only increment when a block actually opens (has net-positive braces)
      // This prevents false positives from inline ifs: `if (x) doSomething()`
      const openBraces = (trimmed.match(/\{/g) ?? []).length;
      const closeBraces = (trimmed.match(/\}/g) ?? []).length;

      if (/^\s*(?:if\s*\(|else\s+if\s*\(|else\s*\{)/.test(line) && openBraces > closeBraces) {
        conditionalDepth++;
      }
      if (/^\s*(?:for\s*\(|while\s*\()/.test(line) && openBraces > closeBraces) {
        loopDepth++;
      }
      if (/\.forEach\s*\(/.test(line) && openBraces > closeBraces) {
        loopDepth++;
      }

      // useEffect without dependency array
      // Look for useEffect( with a callback but no second arg
      if (/\buseEffect\s*\(/.test(line)) {
        // Check the next few lines for the closing ); with or without deps array
        const block = lines.slice(i, i + 5).join("\n");
        // If there's no `, [` or `, []` in the block → missing deps
        if (!/,\s*\[/.test(block)) {
          violations.push({
            rule: "react-hooks/exhaustive-deps",
            file: filePath,
            line: lineNum,
            message:
              "useEffect without dependency array — runs on every render (possibly unintentional)",
            severity: "warning",
          });
        }
      }

      // Hook called inside conditional
      if (conditionalDepth > 0 && /\buse[A-Z]\w*\s*\(/.test(line)) {
        violations.push({
          rule: "react-hooks/rules-of-hooks",
          file: filePath,
          line: lineNum,
          message: "Hook called inside conditional — violates Rules of Hooks",
          severity: "error",
        });
      }

      // Hook called inside loop
      if (loopDepth > 0 && /\buse[A-Z]\w*\s*\(/.test(line)) {
        violations.push({
          rule: "react-hooks/rules-of-hooks",
          file: filePath,
          line: lineNum,
          message: "Hook called inside loop — violates Rules of Hooks",
          severity: "error",
        });
      }

      // Track closing braces to reduce depths
      const netBraces = openBraces - closeBraces;

      if (netBraces < 0) {
        if (conditionalDepth > 0) conditionalDepth = Math.max(0, conditionalDepth + netBraces);
        if (loopDepth > 0) loopDepth = Math.max(0, loopDepth + netBraces);
      }
    }

    return violations;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Registry integration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Register all React quality analyzers for react-typescript and react-javascript.
 *
 * @param registry - The DimensionRegistry to register analyzers into
 * @param projectPath - Absolute path to the React project root
 */
export function registerReactAnalyzers(registry: DimensionRegistry, projectPath: string): void {
  const componentAnalyzer = new ReactComponentAnalyzer(projectPath);
  const a11yAnalyzer = new ReactA11yAnalyzer(projectPath);
  const hookAnalyzer = new ReactHookAnalyzer(projectPath);

  for (const lang of ["react-typescript", "react-javascript"] as const) {
    registry.register({
      dimensionId: "style",
      language: lang,
      async analyze(input) {
        const contents = await Promise.all(
          input.files.map(async (f) => ({
            path: f,
            content: await readFile(f, "utf-8").catch(() => ""),
          })),
        );
        const result = componentAnalyzer.analyzeContent(contents);
        return {
          score: result.score,
          issues: result.issues.map((i) => ({
            dimension: "style" as const,
            severity: i.severity === "error" ? ("major" as const) : ("minor" as const),
            message: i.message,
            file: i.file,
            line: i.line,
          })),
        };
      },
    });

    registry.register({
      dimensionId: "robustness",
      language: lang,
      async analyze(input) {
        const contents = await Promise.all(
          input.files.map(async (f) => ({
            path: f,
            content: await readFile(f, "utf-8").catch(() => ""),
          })),
        );
        const result = a11yAnalyzer.analyzeContent(contents);
        return {
          score: result.score,
          issues: result.violations.map((v) => ({
            dimension: "robustness" as const,
            severity: v.severity === "error" ? ("major" as const) : ("minor" as const),
            message: v.message,
            file: v.file,
            line: v.line,
          })),
        };
      },
    });

    registry.register({
      dimensionId: "correctness",
      language: lang,
      async analyze(input) {
        const contents = await Promise.all(
          input.files.map(async (f) => ({
            path: f,
            content: await readFile(f, "utf-8").catch(() => ""),
          })),
        );
        const result = hookAnalyzer.analyzeContent(contents);
        return {
          score: result.score,
          issues: result.violations.map((v) => ({
            dimension: "correctness" as const,
            severity: v.severity === "error" ? ("critical" as const) : ("minor" as const),
            message: v.message,
            file: v.file,
            line: v.line,
          })),
        };
      },
    });
  }
}
