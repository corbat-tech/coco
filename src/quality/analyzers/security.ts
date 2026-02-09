/**
 * Real Security Scanner for Corbat-Coco
 * Pattern-based detection + optional Snyk integration
 */

import { execa } from "execa";

/**
 * Security vulnerability severity levels
 */
export type VulnerabilitySeverity = "critical" | "high" | "medium" | "low";

/**
 * Security vulnerability interface
 */
export interface SecurityVulnerability {
  severity: VulnerabilitySeverity;
  type: string;
  location: { file: string; line?: number; column?: number };
  description: string;
  recommendation: string;
  cwe?: string; // Common Weakness Enumeration ID
}

/**
 * Security scan result
 */
export interface SecurityResult {
  vulnerabilities: SecurityVulnerability[];
  score: number; // 0-100 (100 = no vulnerabilities)
  passed: boolean;
  scannedFiles: number;
  scanDuration: number;
}

/**
 * Security pattern for detection
 */
interface SecurityPattern {
  regex: RegExp;
  severity: VulnerabilitySeverity;
  type: string;
  message: string;
  cwe?: string;
  recommendation: string;
}

/**
 * OWASP Top 10 and common vulnerability patterns
 */
const SECURITY_PATTERNS: SecurityPattern[] = [
  // Code Injection
  {
    regex: /eval\s*\(/g,
    severity: "critical",
    type: "Code Injection",
    message: "Use of eval() allows arbitrary code execution",
    cwe: "CWE-95",
    recommendation: "Never use eval(). Use JSON.parse() for JSON or safer alternatives.",
  },
  {
    regex: /new\s+Function\s*\(/g,
    severity: "critical",
    type: "Code Injection",
    message: "Use of Function() constructor allows arbitrary code execution",
    cwe: "CWE-95",
    recommendation: "Avoid Function() constructor. Use proper function declarations.",
  },

  // Command Injection
  {
    regex: /exec\s*\(/g,
    severity: "critical",
    type: "Command Injection",
    message: "Use of exec() can execute shell commands with user input",
    cwe: "CWE-78",
    recommendation: "Use execa with array arguments or execFile() instead. Validate all inputs.",
  },
  {
    regex: /child_process\.\s*exec\s*\(/g,
    severity: "critical",
    type: "Command Injection",
    message: "Direct use of child_process.exec() is dangerous",
    cwe: "CWE-78",
    recommendation: "Use execFile() or execa with array arguments. Never interpolate user input.",
  },

  // SQL Injection
  {
    regex:
      /(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,100}?\+[\s\S]{0,50}?(?:req\.|request\.|params\.|query\.|body\.)/gi,
    severity: "critical",
    type: "SQL Injection",
    message: "SQL query using string concatenation with user input",
    cwe: "CWE-89",
    recommendation:
      "Use parameterized queries or prepared statements. Never concatenate user input into SQL.",
  },
  {
    regex: /\.query\s*\(\s*[`"'].*?\$\{/g,
    severity: "critical",
    type: "SQL Injection",
    message: "SQL query using template literals with interpolation",
    cwe: "CWE-89",
    recommendation: "Use parameterized queries with placeholders ($1, ?, etc.)",
  },

  // XSS (Cross-Site Scripting)
  {
    regex: /\.innerHTML\s*=/g,
    severity: "high",
    type: "XSS",
    message: "Setting innerHTML directly can lead to XSS attacks",
    cwe: "CWE-79",
    recommendation: "Use textContent, innerText, or DOMPurify for sanitization.",
  },
  {
    regex: /dangerouslySetInnerHTML/g,
    severity: "high",
    type: "XSS",
    message: "React dangerouslySetInnerHTML can lead to XSS if not sanitized",
    cwe: "CWE-79",
    recommendation: "Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML.",
  },
  {
    regex: /document\.write\s*\(/g,
    severity: "high",
    type: "XSS",
    message: "document.write() can be exploited for XSS",
    cwe: "CWE-79",
    recommendation: "Use DOM APIs like appendChild() or createElement().",
  },

  // Path Traversal
  {
    regex:
      /(?:readFile|writeFile|unlink|rm)[\s\S]{0,100}?\+[\s\S]{0,50}?(?:req\.|request\.|params\.|query\.)/gi,
    severity: "high",
    type: "Path Traversal",
    message: "File operation with user input without validation",
    cwe: "CWE-22",
    recommendation:
      "Validate and sanitize file paths. Use path.resolve() and check if path is within allowed directory.",
  },

  // Insecure Randomness
  {
    regex: /Math\.random\(\)/g,
    severity: "medium",
    type: "Weak Randomness",
    message: "Math.random() is not cryptographically secure",
    cwe: "CWE-330",
    recommendation:
      "Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive operations.",
  },

  // Hardcoded Secrets
  {
    regex: /(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{8,}["']/gi,
    severity: "critical",
    type: "Hardcoded Secret",
    message: "Possible hardcoded password or API key",
    cwe: "CWE-798",
    recommendation:
      "Use environment variables or secure secret management. Never commit secrets to code.",
  },

  // Insecure Cryptography
  {
    regex: /crypto\.createCipher\(/g,
    severity: "high",
    type: "Weak Cryptography",
    message: "createCipher() uses weak MD5 for key derivation",
    cwe: "CWE-327",
    recommendation:
      "Use crypto.createCipheriv() with explicit IV and strong algorithms like AES-256-GCM.",
  },

  // Prototype Pollution
  {
    regex: /__proto__/g,
    severity: "high",
    type: "Prototype Pollution",
    message: "Direct use of __proto__ can lead to prototype pollution",
    cwe: "CWE-1321",
    recommendation: "Avoid __proto__. Use Object.create() or Object.setPrototypeOf().",
  },

  // Regex DOS
  {
    regex: /new\s+RegExp\s*\(\s*(?:req\.|request\.|params\.|query\.)/g,
    severity: "medium",
    type: "ReDoS",
    message: "Creating RegExp from user input can cause ReDoS attacks",
    cwe: "CWE-1333",
    recommendation: "Never create regex from user input. Use pre-defined patterns with timeouts.",
  },

  // Unsafe Deserialization
  {
    regex: /JSON\.parse\s*\(\s*(?:req\.|request\.|params\.)/g,
    severity: "medium",
    type: "Unsafe Deserialization",
    message: "Parsing JSON from untrusted input without validation",
    cwe: "CWE-502",
    recommendation: "Validate JSON structure with JSON schema or Zod before parsing.",
  },
];

/**
 * Pattern-based Security Scanner
 */
export class PatternSecurityScanner {
  /**
   * Scan files for security vulnerabilities using pattern matching
   */
  async scan(files: Array<{ path: string; content: string }>): Promise<SecurityResult> {
    const startTime = performance.now();
    const vulnerabilities: SecurityVulnerability[] = [];

    for (const file of files) {
      for (const pattern of SECURITY_PATTERNS) {
        // Reset regex state
        pattern.regex.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(file.content)) !== null) {
          const line = this.getLineNumber(file.content, match.index);
          const column = this.getColumnNumber(file.content, match.index);

          vulnerabilities.push({
            severity: pattern.severity,
            type: pattern.type,
            location: { file: file.path, line, column },
            description: pattern.message,
            recommendation: pattern.recommendation,
            cwe: pattern.cwe,
          });
        }
      }
    }

    const scanDuration = performance.now() - startTime;
    const score = this.calculateScore(vulnerabilities);

    return {
      vulnerabilities,
      score,
      passed: score === 100,
      scannedFiles: files.length,
      scanDuration,
    };
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    const lines = content.substring(0, index).split("\n");
    return lines.length;
  }

  /**
   * Get column number from character index
   */
  private getColumnNumber(content: string, index: number): number {
    const lines = content.substring(0, index).split("\n");
    const lastLine = lines[lines.length - 1] ?? "";
    return lastLine.length + 1;
  }

  /**
   * Calculate security score based on vulnerabilities
   * Critical: -25 points each
   * High: -10 points each
   * Medium: -5 points each
   * Low: -2 points each
   */
  private calculateScore(vulnerabilities: SecurityVulnerability[]): number {
    let score = 100;

    for (const vuln of vulnerabilities) {
      switch (vuln.severity) {
        case "critical":
          score -= 25;
          break;
        case "high":
          score -= 10;
          break;
        case "medium":
          score -= 5;
          break;
        case "low":
          score -= 2;
          break;
      }
    }

    return Math.max(0, score);
  }
}

/**
 * Snyk Security Scanner (optional, requires snyk CLI)
 */
export class SnykSecurityScanner {
  constructor(private projectPath: string) {}

  /**
   * Scan project with Snyk (requires authentication)
   */
  async scan(): Promise<SecurityResult> {
    const startTime = performance.now();

    try {
      // Check if snyk is authenticated
      const authCheck = await execa("snyk", ["config", "get", "api"], {
        cwd: this.projectPath,
        reject: false,
      });

      if (authCheck.exitCode !== 0) {
        throw new Error("Snyk not authenticated. Run: snyk auth");
      }

      // Run snyk test
      const result = await execa("snyk", ["test", "--json"], {
        cwd: this.projectPath,
        reject: false,
      });

      const report = JSON.parse(result.stdout || result.stderr);
      const vulnerabilities = this.parseSnykReport(report);
      const scanDuration = performance.now() - startTime;

      return {
        vulnerabilities,
        score: this.calculateScore(vulnerabilities),
        passed: vulnerabilities.length === 0,
        scannedFiles: 0, // Snyk scans dependencies, not files
        scanDuration,
      };
    } catch (error) {
      throw new Error(
        `Snyk scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Parse Snyk JSON report
   */
  private parseSnykReport(report: any): SecurityVulnerability[] {
    if (!report.vulnerabilities) return [];

    return report.vulnerabilities.map((v: any) => ({
      severity: v.severity as VulnerabilitySeverity,
      type: "Dependency Vulnerability",
      location: { file: "package.json" },
      description: `${v.title} in ${v.moduleName}@${v.version}`,
      recommendation: v.fixedIn?.length
        ? `Update to version ${v.fixedIn.join(" or ")}`
        : v.nearestFixedInVersion
          ? `Update to version ${v.nearestFixedInVersion}`
          : "No fix available yet. Consider alternative package.",
      cwe: v.identifiers?.CWE?.[0],
    }));
  }

  private calculateScore(vulnerabilities: SecurityVulnerability[]): number {
    let score = 100;
    for (const vuln of vulnerabilities) {
      switch (vuln.severity) {
        case "critical":
          score -= 25;
          break;
        case "high":
          score -= 10;
          break;
        case "medium":
          score -= 5;
          break;
        case "low":
          score -= 2;
          break;
      }
    }
    return Math.max(0, score);
  }
}

/**
 * Composite Security Scanner - combines pattern and Snyk scanning
 */
export class CompositeSecurityScanner {
  private patternScanner = new PatternSecurityScanner();
  private snykScanner: SnykSecurityScanner | null = null;

  constructor(projectPath: string, useSnyk: boolean = true) {
    if (useSnyk) {
      this.snykScanner = new SnykSecurityScanner(projectPath);
    }
  }

  /**
   * Run both pattern and Snyk scans
   */
  async scan(files: Array<{ path: string; content: string }>): Promise<SecurityResult> {
    const startTime = performance.now();

    // Run pattern scan
    const patternResult = await this.patternScanner.scan(files);

    // Try Snyk scan (optional)
    let snykResult: SecurityResult | null = null;
    if (this.snykScanner) {
      try {
        snykResult = await this.snykScanner.scan();
      } catch {
        // Snyk not available, continue with pattern results only
      }
    }

    // Combine results
    const allVulnerabilities = [
      ...patternResult.vulnerabilities,
      ...(snykResult?.vulnerabilities ?? []),
    ];

    const scanDuration = performance.now() - startTime;

    // Weighted score: 70% pattern, 30% Snyk
    const score = snykResult
      ? Math.round(patternResult.score * 0.7 + snykResult.score * 0.3)
      : patternResult.score;

    return {
      vulnerabilities: allVulnerabilities,
      score,
      passed: score === 100,
      scannedFiles: patternResult.scannedFiles,
      scanDuration,
    };
  }
}

/**
 * Create security scanner instance
 */
export function createSecurityScanner(
  projectPath: string,
  useSnyk: boolean = true,
): CompositeSecurityScanner {
  return new CompositeSecurityScanner(projectPath, useSnyk);
}
