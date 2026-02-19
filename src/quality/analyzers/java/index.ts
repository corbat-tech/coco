/**
 * Java Quality Analyzers
 *
 * Static analysis for Java projects without requiring external tools.
 * All analyzers operate purely on source file content.
 *
 * Supported dimensions:
 * - complexity   → cyclomatic complexity of Java methods
 * - security     → pattern-based vulnerability detection (OWASP)
 * - style        → Java naming conventions and formatting
 * - documentation → Javadoc coverage
 * - testCoverage  → JaCoCo XML report parsing (if available)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import type { DimensionRegistry } from "../../dimension-registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────────────────────

interface JavaFileInput {
  path: string;
  content: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared module-level helper (used by all 4 analyzer classes)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Finds Java source files recursively under projectPath.
 *
 * @param projectPath - Absolute path to the project root
 * @param options.includeTests - When false, excludes files matching *Test*.java / *Spec*.java patterns (default: true)
 * @param options.srcPattern - Glob pattern for source files (default: "**\/*.java")
 */
export async function findJavaFiles(
  projectPath: string,
  options?: { includeTests?: boolean; srcPattern?: string },
): Promise<string[]> {
  const { includeTests = true, srcPattern = "**/*.java" } = options ?? {};
  const ignore = ["**/node_modules/**", "**/target/**", "**/build/**"];
  if (!includeTests) {
    ignore.push("**/*Test*.java", "**/*Spec*.java");
  }
  return glob(srcPattern, {
    cwd: projectPath,
    absolute: true,
    ignore,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// JavaComplexityAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface JavaComplexityResult {
  score: number;
  totalMethods: number;
  averageComplexity: number;
  complexMethods: Array<{ method: string; file: string; complexity: number }>;
}

/**
 * Keywords that increment cyclomatic complexity. Has /g flag.
 * Use with String.prototype.match() (safe — returns all matches without mutating lastIndex).
 * Do NOT use with RegExp.prototype.exec() in a loop — that would advance lastIndex.
 */
const BRANCH_KEYWORDS = /\b(if|else if|for|while|do|case|catch|&&|\|\||\?)\b/g;

/**
 * Pattern to detect method declarations in Java
 */
const METHOD_PATTERN =
  /(?:public|private|protected|static|final|synchronized|abstract)\s+[\w<>[\]]+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g;

/**
 * Analyzes cyclomatic complexity of Java methods.
 * Uses pattern-based method detection and branch keyword counting.
 */
export class JavaComplexityAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<JavaComplexityResult> {
    const javaFiles = files ?? (await findJavaFiles(this.projectPath));
    if (!javaFiles.length) {
      return { score: 100, totalMethods: 0, averageComplexity: 1, complexMethods: [] };
    }

    const fileContents: JavaFileInput[] = await Promise.all(
      javaFiles.map(async (f) => ({
        path: f,
        content: await readFile(f, "utf-8").catch(() => ""),
      })),
    );

    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: JavaFileInput[]): JavaComplexityResult {
    if (!files.length) {
      return { score: 100, totalMethods: 0, averageComplexity: 1, complexMethods: [] };
    }

    let totalComplexity = 0;
    let totalMethods = 0;
    const complexMethods: JavaComplexityResult["complexMethods"] = [];

    for (const { path: filePath, content } of files) {
      const methods = this.extractMethodBlocks(content);
      for (const method of methods) {
        const complexity = this.calculateComplexity(method.body);
        totalComplexity += complexity;
        totalMethods++;
        if (complexity > 10) {
          complexMethods.push({ method: method.name, file: filePath, complexity });
        }
      }
    }

    const averageComplexity = totalMethods > 0 ? totalComplexity / totalMethods : 1;

    // Score: average complexity ≤ 5 → 100, ≥ 20 → 0
    const score = Math.max(0, Math.min(100, Math.round(100 - (averageComplexity - 1) * 6.5)));

    return { score, totalMethods, averageComplexity, complexMethods };
  }

  private extractMethodBlocks(content: string): Array<{ name: string; body: string }> {
    const methods: Array<{ name: string; body: string }> = [];
    const methodRegex = new RegExp(METHOD_PATTERN.source, "g");
    let match;

    while ((match = methodRegex.exec(content)) !== null) {
      const nameMatch = /\s(\w+)\s*\(/.exec(match[0]);
      const methodName = nameMatch ? nameMatch[1] ?? "unknown" : "unknown";
      const body = this.extractBlock(content, match.index + match[0].length - 1);
      methods.push({ name: methodName, body });
    }

    return methods;
  }

  private extractBlock(content: string, openBraceIndex: number): string {
    let depth = 1;
    let i = openBraceIndex + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }
    return content.slice(openBraceIndex, i);
  }

  private calculateComplexity(body: string): number {
    const matches = body.match(BRANCH_KEYWORDS) ?? [];
    return 1 + matches.length;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// JavaSecurityAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface JavaVulnerability {
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  file: string;
  line: number;
  description: string;
  recommendation: string;
  cwe?: string;
}

export interface JavaSecurityResult {
  score: number;
  vulnerabilities: JavaVulnerability[];
}

interface JavaSecurityPattern {
  regex: RegExp;
  severity: JavaVulnerability["severity"];
  type: string;
  description: string;
  recommendation: string;
  cwe?: string;
}

/**
 * Java-specific OWASP vulnerability patterns
 */
const JAVA_SECURITY_PATTERNS: JavaSecurityPattern[] = [
  // SQL Injection — string concatenation in any execute/executeQuery/executeUpdate call
  {
    regex: /\.execute[A-Za-z]*\s*\(\s*["'][^"']*["']\s*\+/,
    severity: "critical",
    type: "SQL Injection",
    description: "String concatenation in SQL query — vulnerable to injection",
    recommendation: "Use PreparedStatement with parameterized queries",
    cwe: "CWE-89",
  },
  {
    regex: /createQuery\s*\(\s*["'].*\+|createNativeQuery\s*\(\s*["'].*\+/,
    severity: "critical",
    type: "SQL Injection (JPQL)",
    description: "String concatenation in JPQL/native query",
    recommendation: "Use named parameters with setParameter()",
    cwe: "CWE-89",
  },
  // Hardcoded Credentials
  {
    regex: /(?:password|passwd|secret|apiKey|api_key)\s*=\s*["'][^"']{4,}["']/i,
    severity: "high",
    type: "Hardcoded Credential",
    description: "Hardcoded credential or secret detected",
    recommendation: "Store credentials in environment variables or a secrets manager",
    cwe: "CWE-798",
  },
  // Unsafe Deserialization
  {
    regex: /new\s+(?:java\.io\.)?ObjectInputStream/,
    severity: "high",
    type: "Unsafe Deserialization",
    description: "Unsafe Java deserialization can lead to RCE",
    recommendation: "Use safer serialization formats (JSON) or whitelist classes",
    cwe: "CWE-502",
  },
  // Path Traversal
  {
    regex: /new\s+(?:java\.io\.)?File\s*\(\s*(?:request\.|user|input)/,
    severity: "high",
    type: "Path Traversal",
    description: "File path constructed from user input",
    recommendation: "Sanitize and validate file paths; use Paths.get() with canonical path check",
    cwe: "CWE-22",
  },
  // Command Injection
  {
    regex: /Runtime\.getRuntime\(\)\.exec\s*\(\s*[^"]/,
    severity: "critical",
    type: "Command Injection",
    description: "Dynamic command execution — vulnerable to injection",
    recommendation: "Use ProcessBuilder with a fixed command array",
    cwe: "CWE-78",
  },
  // XXE
  {
    regex: /DocumentBuilderFactory\s*\.\s*newInstance\s*\(\s*\)/,
    severity: "high",
    type: "XML External Entity (XXE)",
    description: "XML parsing without disabling external entities",
    recommendation: "Disable external entities: factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)",
    cwe: "CWE-611",
  },
  // Insecure Random
  {
    regex: /new\s+(?:java\.util\.)?Random\s*\(\s*\)(?!\s*\/\/.*secure)/,
    severity: "medium",
    type: "Insecure Random",
    description: "java.util.Random is not cryptographically secure",
    recommendation: "Use SecureRandom for security-sensitive operations",
    cwe: "CWE-338",
  },
];

/**
 * Scans Java source files for OWASP security vulnerabilities using pattern matching.
 */
export class JavaSecurityAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<JavaSecurityResult> {
    const javaFiles = files ?? (await findJavaFiles(this.projectPath, { includeTests: false }));
    if (!javaFiles.length) {
      return { score: 100, vulnerabilities: [] };
    }

    const fileContents: JavaFileInput[] = await Promise.all(
      javaFiles.map(async (f) => ({
        path: f,
        content: await readFile(f, "utf-8").catch(() => ""),
      })),
    );

    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: JavaFileInput[]): JavaSecurityResult {
    if (!files.length) return { score: 100, vulnerabilities: [] };

    const vulnerabilities: JavaVulnerability[] = [];

    for (const { path: filePath, content } of files) {
      const lines = content.split("\n");
      for (const pattern of JAVA_SECURITY_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (pattern.regex.test(line)) {
            vulnerabilities.push({
              severity: pattern.severity,
              type: pattern.type,
              file: filePath,
              line: i + 1,
              description: pattern.description,
              recommendation: pattern.recommendation,
              cwe: pattern.cwe,
            });
          }
        }
      }
    }

    const score = this.calculateScore(vulnerabilities);
    return { score, vulnerabilities };
  }

  private calculateScore(vulns: JavaVulnerability[]): number {
    let score = 100;
    for (const v of vulns) {
      switch (v.severity) {
        case "critical":
          score -= 30;
          break;
        case "high":
          score -= 15;
          break;
        case "medium":
          score -= 7;
          break;
        case "low":
          score -= 3;
          break;
      }
    }
    return Math.max(0, score);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// JavaStyleAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface StyleViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface JavaStyleResult {
  score: number;
  violations: StyleViolation[];
}

const MAX_LINE_LENGTH = 120;

/**
 * Checkstyle-inspired Java style analyzer.
 * Checks naming conventions, line length, and basic formatting.
 */
export class JavaStyleAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<JavaStyleResult> {
    const javaFiles = files ?? (await findJavaFiles(this.projectPath));
    if (!javaFiles.length) return { score: 100, violations: [] };

    const fileContents: JavaFileInput[] = await Promise.all(
      javaFiles.map(async (f) => ({
        path: f,
        content: await readFile(f, "utf-8").catch(() => ""),
      })),
    );

    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: JavaFileInput[]): JavaStyleResult {
    if (!files.length) return { score: 100, violations: [] };

    const violations: StyleViolation[] = [];

    for (const { path: filePath, content } of files) {
      violations.push(...this.checkFile(filePath, content));
    }

    // Score: each error = -10 points, each warning = -5 points
    const deduction = violations.reduce(
      (sum, v) => sum + (v.severity === "error" ? 10 : 5),
      0,
    );
    const score = Math.max(0, 100 - deduction);

    return { score, violations };
  }

  private checkFile(filePath: string, content: string): StyleViolation[] {
    const violations: StyleViolation[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineNum = i + 1;

      // Line length check
      if (line.length > MAX_LINE_LENGTH) {
        violations.push({
          rule: "LineLength",
          file: filePath,
          line: lineNum,
          message: `Line length ${line.length} exceeds ${MAX_LINE_LENGTH} characters`,
          severity: "warning",
        });
      }

      // Class naming (PascalCase — must start with uppercase)
      const classMatch = /^(?:public|private|protected)?\s*(?:class|interface|enum|record)\s+([a-z]\w*)/.exec(line);
      if (classMatch) {
        violations.push({
          rule: "TypeName",
          file: filePath,
          line: lineNum,
          message: `Type name '${classMatch[1]}' should start with uppercase letter (PascalCase)`,
          severity: "error",
        });
      }

      // Method naming (camelCase — must NOT start with uppercase)
      const methodMatch = /\b(?:public|private|protected|static)\s+(?!class|interface|enum|record|new\b)(?:void|[\w<>[\]]+)\s+([A-Z]\w*)\s*\(/.exec(line);
      if (methodMatch && !line.trim().startsWith("class") && !line.includes("class ")) {
        violations.push({
          rule: "MethodName",
          file: filePath,
          line: lineNum,
          message: `Method name '${methodMatch[1]}' should start with lowercase letter (camelCase)`,
          severity: "error",
        });
      }

      // Constant naming (UPPER_SNAKE_CASE)
      const constantMatch = /\bpublic\s+static\s+final\s+\w+\s+([a-z][a-zA-Z]+)\s*=/.exec(line);
      if (constantMatch) {
        violations.push({
          rule: "ConstantName",
          file: filePath,
          line: lineNum,
          message: `Constant '${constantMatch[1]}' should be UPPER_SNAKE_CASE`,
          severity: "warning",
        });
      }

      // Excessive method parameters (>5)
      const paramsMatch = /\w+\s+\w+\s*\(([^)]+)\)/.exec(line);
      if (paramsMatch) {
        const paramCount = (paramsMatch[1] ?? "").split(",").length;
        if (paramCount > 5) {
          violations.push({
            rule: "ParameterNumber",
            file: filePath,
            line: lineNum,
            message: `Method has ${paramCount} parameters (max recommended: 5)`,
            severity: "warning",
          });
        }
      }

      // Missing space before { (opening brace)
      if (/\)\{/.test(line) || /\belse\{/.test(line)) {
        violations.push({
          rule: "WhitespaceAround",
          file: filePath,
          line: lineNum,
          message: "Missing space before '{'",
          severity: "warning",
        });
      }
    }

    return violations;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// JavaDocumentationAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface JavaDocumentationResult {
  score: number;
  javadocCoverage: number;
  totalMethods: number;
  documentedMethods: number;
  undocumentedPublicMethods: string[];
}

/**
 * Measures Javadoc coverage for public methods and classes.
 */
export class JavaDocumentationAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(files?: string[]): Promise<JavaDocumentationResult> {
    const javaFiles = files ?? (await findJavaFiles(this.projectPath, { srcPattern: "src/main/**/*.java" }));
    if (!javaFiles.length) {
      return { score: 100, javadocCoverage: 1, totalMethods: 0, documentedMethods: 0, undocumentedPublicMethods: [] };
    }

    const fileContents: JavaFileInput[] = await Promise.all(
      javaFiles.map(async (f) => ({
        path: f,
        content: await readFile(f, "utf-8").catch(() => ""),
      })),
    );

    return this.analyzeContent(fileContents);
  }

  analyzeContent(files: JavaFileInput[]): JavaDocumentationResult {
    if (!files.length) {
      return { score: 100, javadocCoverage: 1, totalMethods: 0, documentedMethods: 0, undocumentedPublicMethods: [] };
    }

    let totalMethods = 0;
    let documentedMethods = 0;
    const undocumentedPublicMethods: string[] = [];

    for (const { content } of files) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Detect public method declarations
        if (/\b(?:public)\s+(?!class|interface|enum|record)[\w<>[\]]+\s+\w+\s*\(/.test(line)) {
          totalMethods++;
          // Check if the preceding non-empty line ends a Javadoc block
          const isDocumented = this.hasPrecedingJavadoc(lines, i);
          if (isDocumented) {
            documentedMethods++;
          } else {
            const nameMatch = /\s(\w+)\s*\(/.exec(line);
            if (nameMatch) undocumentedPublicMethods.push(nameMatch[1] ?? "unknown");
          }
        }
      }
    }

    const javadocCoverage = totalMethods > 0 ? documentedMethods / totalMethods : 1;
    const score = Math.round(javadocCoverage * 100);

    return { score, javadocCoverage, totalMethods, documentedMethods, undocumentedPublicMethods };
  }

  private hasPrecedingJavadoc(lines: string[], methodLineIndex: number): boolean {
    // Walk backwards from the method line to find a Javadoc block
    for (let i = methodLineIndex - 1; i >= 0; i--) {
      const prevLine = (lines[i] ?? "").trim();
      if (prevLine === "") continue;
      if (prevLine.endsWith("*/")) {
        // Found end of a doc comment — check if it's Javadoc (starts with /**)
        for (let j = i; j >= 0; j--) {
          const docLine = (lines[j] ?? "").trim();
          if (docLine.startsWith("/**")) return true;
          if (!docLine.startsWith("*") && !docLine.startsWith("/**")) break;
        }
      }
      break;
    }
    return false;
  }

}

// ──────────────────────────────────────────────────────────────────────────────
// JavaCoverageAnalyzer
// ──────────────────────────────────────────────────────────────────────────────

export interface JavaCoverageResult {
  score: number;
  lineCoverage: number;
  branchCoverage: number;
  methodCoverage: number;
  reportFound: boolean;
}

const JACOCO_REPORT_PATHS = [
  "target/site/jacoco/jacoco.xml",
  "build/reports/jacoco/test/jacocoTestReport.xml",
  "build/reports/jacoco/jacocoTestReport.xml",
];

/**
 * Parses JaCoCo XML coverage reports to extract line, branch, and method coverage.
 * Returns a default score of 0 when no report is found.
 */
export class JavaCoverageAnalyzer {
  constructor(private projectPath: string) {}

  async analyze(): Promise<JavaCoverageResult> {
    for (const reportPath of JACOCO_REPORT_PATHS) {
      try {
        const xml = await readFile(join(this.projectPath, reportPath), "utf-8");
        const result = this.parseJacocoXml(xml);
        return { ...result, reportFound: true };
      } catch {
        // Try next path
      }
    }

    // No JaCoCo report found — return neutral score (50) to avoid falsely penalising
    // projects that haven't configured JaCoCo yet. Score 0 would mean "no coverage"
    // but the truth is "no data". reportFound: false signals that this is a default.
    return { score: 50, lineCoverage: 0, branchCoverage: 0, methodCoverage: 0, reportFound: false };
  }

  parseJacocoXml(xml: string): JavaCoverageResult {
    if (!xml.trim()) {
      return { score: 0, lineCoverage: 0, branchCoverage: 0, methodCoverage: 0, reportFound: false };
    }

    const lineCoverage = this.extractCoverage(xml, "LINE");
    const branchCoverage = this.extractCoverage(xml, "BRANCH");
    const methodCoverage = this.extractCoverage(xml, "METHOD");

    // Weighted score: 50% line, 35% branch, 15% method
    const score = Math.round(lineCoverage * 0.5 + branchCoverage * 0.35 + methodCoverage * 0.15);

    return { score, lineCoverage, branchCoverage, methodCoverage, reportFound: true };
  }

  private extractCoverage(xml: string, type: string): number {
    const regex = new RegExp(
      `<counter\\s+type="${type}"\\s+missed="(\\d+)"\\s+covered="(\\d+)"`,
    );
    const match = regex.exec(xml);
    if (!match) return 0;

    const missed = parseInt(match[1] ?? "0", 10);
    const covered = parseInt(match[2] ?? "0", 10);
    const total = missed + covered;

    return total > 0 ? Math.round((covered / total) * 100) : 0;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Registry integration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Register all Java quality analyzers into the given DimensionRegistry.
 * Call this during app initialization for Java projects.
 *
 * @param registry - The DimensionRegistry to register analyzers into
 * @param projectPath - Absolute path to the Java project root
 */
export function registerJavaAnalyzers(registry: DimensionRegistry, projectPath: string): void {
  const complexityAnalyzer = new JavaComplexityAnalyzer(projectPath);
  const securityAnalyzer = new JavaSecurityAnalyzer(projectPath);
  const styleAnalyzer = new JavaStyleAnalyzer(projectPath);
  const documentationAnalyzer = new JavaDocumentationAnalyzer(projectPath);
  const coverageAnalyzer = new JavaCoverageAnalyzer(projectPath);

  registry.register({
    dimensionId: "complexity",
    language: "java",
    async analyze(input) {
      const result = await complexityAnalyzer.analyze(input.files);
      return { score: result.score, issues: [] };
    },
  });

  registry.register({
    dimensionId: "security",
    language: "java",
    async analyze(input) {
      const contents = await Promise.all(
        input.files.map(async (f) => ({
          path: f,
          content: await readFile(f, "utf-8").catch(() => ""),
        })),
      );
      const result = securityAnalyzer.analyzeContent(contents);
      return {
        score: result.score,
        issues: result.vulnerabilities.map((v) => ({
          dimension: "security" as const,
          severity: v.severity === "critical" ? ("critical" as const) : ("major" as const),
          message: `[${v.type}] ${v.description}`,
          file: v.file,
          line: v.line,
          suggestion: v.recommendation,
        })),
      };
    },
  });

  registry.register({
    dimensionId: "style",
    language: "java",
    async analyze(input) {
      const contents = await Promise.all(
        input.files.map(async (f) => ({
          path: f,
          content: await readFile(f, "utf-8").catch(() => ""),
        })),
      );
      const result = styleAnalyzer.analyzeContent(contents);
      return { score: result.score, issues: [] };
    },
  });

  registry.register({
    dimensionId: "documentation",
    language: "java",
    async analyze(input) {
      const contents = await Promise.all(
        input.files.map(async (f) => ({
          path: f,
          content: await readFile(f, "utf-8").catch(() => ""),
        })),
      );
      const result = documentationAnalyzer.analyzeContent(contents);
      return { score: result.score, issues: [] };
    },
  });

  registry.register({
    dimensionId: "testCoverage",
    language: "java",
    async analyze() {
      const result = await coverageAnalyzer.analyze();
      return { score: result.score, issues: [] };
    },
  });
}
