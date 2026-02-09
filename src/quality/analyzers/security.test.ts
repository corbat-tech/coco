/**
 * Tests for Security Scanner
 */

import { describe, it, expect } from "vitest";
import { PatternSecurityScanner, CompositeSecurityScanner } from "./security.js";

describe("PatternSecurityScanner", () => {
  const scanner = new PatternSecurityScanner();

  describe("Code Injection", () => {
    it("should detect eval() usage", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            const userInput = req.body.code;
            const result = eval(userInput); // VULNERABLE
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]).toMatchObject({
        severity: "critical",
        type: "Code Injection",
        location: { file: "vulnerable.ts", line: 3 },
      });
      expect(result.score).toBeLessThan(100);
      expect(result.passed).toBe(false);
    });

    it("should detect Function() constructor", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `const fn = new Function('return ' + userInput);`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Code Injection");
      expect(result.vulnerabilities[0]?.severity).toBe("critical");
    });
  });

  describe("Command Injection", () => {
    it("should detect exec() usage", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            import { exec } from 'child_process';
            exec('ls ' + req.params.dir); // VULNERABLE
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities.length).toBeGreaterThan(0);
      const execVuln = result.vulnerabilities.find((v) => v.type === "Command Injection");
      expect(execVuln).toBeDefined();
      expect(execVuln?.severity).toBe("critical");
    });

    it("should detect child_process.exec()", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `child_process.exec("rm -rf " + directory);`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities.length).toBeGreaterThanOrEqual(1);
      const cmdVuln = result.vulnerabilities.find((v) => v.type === "Command Injection");
      expect(cmdVuln).toBeDefined();
    });
  });

  describe("SQL Injection", () => {
    it("should detect string concatenation in SQL", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            const query = "SELECT * FROM users WHERE id = " + req.params.id;
            db.query(query);
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities.length).toBeGreaterThan(0);
      const sqlVuln = result.vulnerabilities.find((v) => v.type === "SQL Injection");
      expect(sqlVuln).toBeDefined();
      expect(sqlVuln?.severity).toBe("critical");
    });

    it("should detect template literal SQL injection", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: "db.query(`SELECT * FROM users WHERE email = '${email}'`);",
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("SQL Injection");
    });
  });

  describe("XSS", () => {
    it("should detect innerHTML assignment", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            const div = document.getElementById('content');
            div.innerHTML = req.body.html; // VULNERABLE
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("XSS");
      expect(result.vulnerabilities[0]?.severity).toBe("high");
    });

    it("should detect dangerouslySetInnerHTML", async () => {
      const files = [
        {
          path: "Component.tsx",
          content: `<div dangerouslySetInnerHTML={{ __html: userContent }} />`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("XSS");
    });

    it("should detect document.write", async () => {
      const files = [
        {
          path: "vulnerable.js",
          content: `document.write('<script>' + userInput + '</script>');`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("XSS");
    });
  });

  describe("Path Traversal", () => {
    it("should detect file operations with user input", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            import { readFile } from 'fs/promises';
            const content = await readFile('./uploads/' + req.params.filename);
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities.length).toBeGreaterThan(0);
      const pathVuln = result.vulnerabilities.find((v) => v.type === "Path Traversal");
      expect(pathVuln).toBeDefined();
      expect(pathVuln?.severity).toBe("high");
    });
  });

  describe("Weak Randomness", () => {
    it("should detect Math.random()", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `const token = Math.random().toString(36);`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Weak Randomness");
      expect(result.vulnerabilities[0]?.severity).toBe("medium");
    });
  });

  describe("Hardcoded Secrets", () => {
    it("should detect hardcoded passwords", async () => {
      const files = [
        {
          path: "config.ts",
          content: `const password = "MySecretPass123";`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Hardcoded Secret");
      expect(result.vulnerabilities[0]?.severity).toBe("critical");
    });

    it("should detect hardcoded API keys", async () => {
      const files = [
        {
          path: "config.ts",
          content: `const apiKey = "sk-1234567890abcdef";`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Hardcoded Secret");
    });
  });

  describe("Weak Cryptography", () => {
    it("should detect crypto.createCipher()", async () => {
      const files = [
        {
          path: "crypto.ts",
          content: `const cipher = crypto.createCipher('aes-256-cbc', password);`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Weak Cryptography");
      expect(result.vulnerabilities[0]?.severity).toBe("high");
    });
  });

  describe("Prototype Pollution", () => {
    it("should detect __proto__ usage", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `obj.__proto__.polluted = true;`,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]?.type).toBe("Prototype Pollution");
    });
  });

  describe("Score Calculation", () => {
    it("should calculate score correctly", async () => {
      const files = [
        {
          path: "vulnerable.ts",
          content: `
            eval('code');              // -25 (critical)
            div.innerHTML = html;      // -10 (high)
            Math.random();             // -5  (medium)
          `,
        },
      ];

      const result = await scanner.scan(files);

      // 100 - 25 - 10 - 5 = 60
      expect(result.score).toBe(60);
      expect(result.passed).toBe(false);
    });

    it("should return 100 for secure code", async () => {
      const files = [
        {
          path: "secure.ts",
          content: `
            // Secure code
            const value = JSON.parse(validatedInput);
            const hash = crypto.randomBytes(32).toString('hex');
            await db.query('SELECT * FROM users WHERE id = $1', [userId]);
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
    });
  });

  describe("Multiple Vulnerabilities", () => {
    it("should detect all vulnerabilities in a file", async () => {
      const files = [
        {
          path: "very-vulnerable.ts",
          content: `
            // Multiple issues
            eval(userCode);                            // Critical
            exec('rm -rf ' + dir);                     // Critical
            div.innerHTML = untrustedHTML;             // High
            const query = 'SELECT * WHERE id=' + id;   // Critical
            const token = Math.random().toString();    // Medium
          `,
        },
      ];

      const result = await scanner.scan(files);

      expect(result.vulnerabilities.length).toBeGreaterThanOrEqual(4);
      expect(result.score).toBeLessThan(50);
      expect(result.passed).toBe(false);
    });
  });
});

describe("CompositeSecurityScanner", () => {
  it("should scan with pattern scanner only when Snyk disabled", async () => {
    const scanner = new CompositeSecurityScanner("/tmp/test", false);

    const files = [
      {
        path: "test.ts",
        content: `eval(code);`,
      },
    ];

    const result = await scanner.scan(files);

    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.score).toBeLessThan(100);
  });

  it("should provide recommendations for vulnerabilities", async () => {
    const scanner = new CompositeSecurityScanner("/tmp/test", false);

    const files = [
      {
        path: "test.ts",
        content: `eval(code);`,
      },
    ];

    const result = await scanner.scan(files);

    expect(result.vulnerabilities[0]?.recommendation).toContain("Never use eval()");
  });
});
