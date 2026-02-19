/**
 * Tests for Java Quality Analyzers
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  JavaComplexityAnalyzer,
  JavaSecurityAnalyzer,
  JavaStyleAnalyzer,
  JavaDocumentationAnalyzer,
  JavaCoverageAnalyzer,
  registerJavaAnalyzers,
  findJavaFiles,
} from "./index.js";
import { DimensionRegistry } from "../../dimension-registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────────────

const SIMPLE_JAVA = `
package com.example;

/**
 * A simple service class.
 */
public class UserService {
    private final UserRepository repository;

    /**
     * Creates a new UserService.
     * @param repository the user repository
     */
    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    /**
     * Find a user by ID.
     * @param id the user ID
     * @return the user or null
     */
    public User findById(Long id) {
        if (id == null) {
            return null;
        }
        return repository.findById(id).orElse(null);
    }
}
`;

const COMPLEX_JAVA = `
package com.example;

public class ComplexService {
    public String process(String input, int mode) {
        String result = "";
        if (input == null) {
            return null;
        } else if (input.isEmpty()) {
            return "";
        }
        switch (mode) {
            case 1:
                if (input.length() > 10) {
                    result = input.substring(0, 10);
                } else if (input.length() > 5) {
                    result = input.toUpperCase();
                } else {
                    result = input.toLowerCase();
                }
                break;
            case 2:
                for (int i = 0; i < input.length(); i++) {
                    if (Character.isLetter(input.charAt(i))) {
                        result += input.charAt(i);
                    }
                }
                break;
            default:
                while (!result.equals(input)) {
                    result = input;
                    try {
                        result = result.trim();
                    } catch (Exception e) {
                        break;
                    }
                }
        }
        return result;
    }
}
`;

const SECURITY_VULNERABLE_JAVA = `
package com.example;

import java.sql.Connection;
import java.sql.Statement;

public class VulnerableService {
    public void executeQuery(String userId) throws Exception {
        Connection conn = getConnection();
        Statement stmt = conn.createStatement();
        // SQL injection vulnerability
        stmt.execute("SELECT * FROM users WHERE id = " + userId);
    }

    public void printSecret() {
        // Hardcoded credential
        String password = "admin123";
        System.out.println("Password: " + password);
    }

    public void deserialize(byte[] data) throws Exception {
        // Unsafe deserialization
        java.io.ObjectInputStream ois = new java.io.ObjectInputStream(
            new java.io.ByteArrayInputStream(data)
        );
        Object obj = ois.readObject();
    }
}
`;

const POOR_STYLE_JAVA = `
package com.example;
public class bad_class_name {
public static void VeryLongMethodNameThatExceedsRecommendedLength(String x, String y, String z, String a, String b) {
int i=0;
String s="this is a very long string that should be wrapped and is definitely way over the 120 character line limit in Java codebases and violates style guidelines";
}
}
`;

const NO_JAVADOC_JAVA = `
package com.example;

public class NoDocService {
    private String field;

    public NoDocService(String field) {
        this.field = field;
    }

    public String process(String input) {
        return input + field;
    }

    public void reset() {
        field = "";
    }
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// JavaComplexityAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("JavaComplexityAnalyzer", () => {
  it("should return high score for simple code", async () => {
    const analyzer = new JavaComplexityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserService.java", content: SIMPLE_JAVA },
    ]);
    expect(result.score).toBeGreaterThan(75);
  });

  it("should return lower score for complex code", async () => {
    const analyzer = new JavaComplexityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "ComplexService.java", content: COMPLEX_JAVA },
    ]);
    expect(result.score).toBeLessThan(90);
  });

  it("should count branch statements for complexity", async () => {
    const analyzer = new JavaComplexityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "ComplexService.java", content: COMPLEX_JAVA },
    ]);
    expect(result.totalMethods).toBeGreaterThan(0);
    expect(result.averageComplexity).toBeGreaterThan(1);
  });

  it("should handle empty file list", async () => {
    const analyzer = new JavaComplexityAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// JavaSecurityAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("JavaSecurityAnalyzer", () => {
  it("should detect SQL injection vulnerabilities", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "VulnerableService.java", content: SECURITY_VULNERABLE_JAVA },
    ]);
    expect(result.vulnerabilities.length).toBeGreaterThan(0);
    const sqlInjection = result.vulnerabilities.find((v) =>
      v.type.toLowerCase().includes("sql"),
    );
    expect(sqlInjection).toBeDefined();
  });

  it("should detect hardcoded credentials", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "VulnerableService.java", content: SECURITY_VULNERABLE_JAVA },
    ]);
    const hardcoded = result.vulnerabilities.find((v) =>
      v.type.toLowerCase().includes("credential") ||
      v.type.toLowerCase().includes("hardcoded"),
    );
    expect(hardcoded).toBeDefined();
  });

  it("should detect unsafe deserialization", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "VulnerableService.java", content: SECURITY_VULNERABLE_JAVA },
    ]);
    const deser = result.vulnerabilities.find((v) =>
      v.type.toLowerCase().includes("deserializ") ||
      v.type.toLowerCase().includes("object"),
    );
    expect(deser).toBeDefined();
  });

  it("should return perfect score for clean code", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserService.java", content: SIMPLE_JAVA },
    ]);
    expect(result.score).toBe(100);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it("should return score below 80 for multiple vulnerabilities", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "VulnerableService.java", content: SECURITY_VULNERABLE_JAVA },
    ]);
    expect(result.score).toBeLessThan(80);
  });

  it("should handle empty file list", async () => {
    const analyzer = new JavaSecurityAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
    expect(result.vulnerabilities).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// JavaStyleAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("JavaStyleAnalyzer", () => {
  it("should return high score for well-styled code", async () => {
    const analyzer = new JavaStyleAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserService.java", content: SIMPLE_JAVA },
    ]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should detect poor class naming conventions", async () => {
    const analyzer = new JavaStyleAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "bad_class.java", content: POOR_STYLE_JAVA },
    ]);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("should detect excessive line length", async () => {
    const analyzer = new JavaStyleAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "bad_class.java", content: POOR_STYLE_JAVA },
    ]);
    const lineLengthViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("line") || v.rule.toLowerCase().includes("length"),
    );
    expect(lineLengthViolation).toBeDefined();
  });

  it("should return lower score for poor style", async () => {
    const analyzer = new JavaStyleAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "bad_class.java", content: POOR_STYLE_JAVA },
    ]);
    expect(result.score).toBeLessThan(80);
  });

  it("should handle empty file list", async () => {
    const analyzer = new JavaStyleAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// JavaDocumentationAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("JavaDocumentationAnalyzer", () => {
  it("should return high score for well-documented code", async () => {
    const analyzer = new JavaDocumentationAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserService.java", content: SIMPLE_JAVA },
    ]);
    expect(result.score).toBeGreaterThan(70);
    expect(result.javadocCoverage).toBeGreaterThan(0.5);
  });

  it("should return low score for undocumented code", async () => {
    const analyzer = new JavaDocumentationAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "NoDocService.java", content: NO_JAVADOC_JAVA },
    ]);
    expect(result.score).toBeLessThan(50);
    expect(result.javadocCoverage).toBeLessThan(0.5);
  });

  it("should count total and documented methods", async () => {
    const analyzer = new JavaDocumentationAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserService.java", content: SIMPLE_JAVA },
    ]);
    expect(result.totalMethods).toBeGreaterThan(0);
    expect(result.documentedMethods).toBeGreaterThan(0);
  });

  it("should handle empty file list", async () => {
    const analyzer = new JavaDocumentationAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// JavaCoverageAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("JavaCoverageAnalyzer", () => {
  it("should return default score when no JaCoCo report found", async () => {
    const analyzer = new JavaCoverageAnalyzer("/nonexistent");
    const result = await analyzer.analyze();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reportFound).toBe(false);
  });

  it("should return neutral score of 50 (not 0) when no JaCoCo report is present", async () => {
    // Score 0 would falsely penalise projects without JaCoCo configured.
    // Score 50 signals "no data" rather than "0% coverage".
    const analyzer = new JavaCoverageAnalyzer("/nonexistent");
    const result = await analyzer.analyze();
    expect(result.score).toBe(50);
    expect(result.reportFound).toBe(false);
    expect(result.lineCoverage).toBe(0);
    expect(result.branchCoverage).toBe(0);
    expect(result.methodCoverage).toBe(0);
  });

  it("should parse JaCoCo XML report when available", async () => {
    const analyzer = new JavaCoverageAnalyzer("/project");
    const jacocoXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN">
<report name="test">
  <counter type="LINE" missed="10" covered="90"/>
  <counter type="BRANCH" missed="5" covered="45"/>
  <counter type="METHOD" missed="2" covered="18"/>
</report>`;

    const result = await analyzer.parseJacocoXml(jacocoXml);
    expect(result.lineCoverage).toBeCloseTo(90, 0); // 90/(90+10) = 90%
    expect(result.branchCoverage).toBeCloseTo(90, 0); // 45/(45+5) = 90%
    expect(result.score).toBeGreaterThan(80);
  });

  it("should handle empty JaCoCo report", async () => {
    const analyzer = new JavaCoverageAnalyzer("/project");
    const result = await analyzer.parseJacocoXml("");
    expect(result.score).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// registerJavaAnalyzers tests
// ──────────────────────────────────────────────────────────────────────────────

describe("registerJavaAnalyzers", () => {
  it("should register analyzers for java language", () => {
    const registry = new DimensionRegistry();
    registerJavaAnalyzers(registry, "/project");
    expect(registry.hasAnalyzers("java")).toBe(true);
  });

  it("should register analyzers for all key dimensions", () => {
    const registry = new DimensionRegistry();
    registerJavaAnalyzers(registry, "/project");

    const javaAnalyzers = registry.getAnalyzers("java");
    const dimensionIds = new Set(javaAnalyzers.map((a) => a.dimensionId));

    expect(dimensionIds).toContain("complexity");
    expect(dimensionIds).toContain("security");
    expect(dimensionIds).toContain("style");
    expect(dimensionIds).toContain("documentation");
    expect(dimensionIds).toContain("testCoverage");
  });

  it("should not register analyzers for typescript language", () => {
    const registry = new DimensionRegistry();
    registerJavaAnalyzers(registry, "/project");

    const tsAnalyzers = registry.getAnalyzers("typescript");
    expect(tsAnalyzers).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findJavaFiles — shared module-level helper tests
// Verifies that the unified findJavaFiles function correctly discovers files
// and respects the includeTests option.
// ──────────────────────────────────────────────────────────────────────────────

describe("findJavaFiles — shared helper", () => {
  it("finds all .java files and excludes test files when includeTests is false", async () => {
    // Create a temporary project structure
    const tmpDir = await mkdtemp(join(tmpdir(), "coco-java-test-"));
    try {
      await mkdir(join(tmpDir, "src"), { recursive: true });
      await writeFile(join(tmpDir, "src", "UserService.java"), "public class UserService {}");
      await writeFile(join(tmpDir, "src", "UserServiceTest.java"), "public class UserServiceTest {}");
      await writeFile(join(tmpDir, "src", "UserSpec.java"), "public class UserSpec {}");

      const allFiles = await findJavaFiles(tmpDir);
      const nonTestFiles = await findJavaFiles(tmpDir, { includeTests: false });

      // All 3 files found by default
      expect(allFiles.length).toBe(3);
      // Test files excluded when includeTests: false
      expect(nonTestFiles.length).toBe(1);
      expect(nonTestFiles[0]).toContain("UserService.java");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
