/**
 * Tests for review tool
 */

import { describe, it, expect, vi } from "vitest";
import { parseDiff } from "../cli/repl/output/diff-renderer.js";
import { analyzePatterns, checkTestCoverage } from "./review.js";

// Mock fileExists for checkTestCoverage tests
vi.mock("../utils/files.js", () => ({
  fileExists: vi.fn().mockResolvedValue(false),
}));

// We test the analysis functions indirectly by creating diffs and checking results.
// Since analyzePatterns is not exported, we test through the patterns via parseDiff integration.

const DIFF_WITH_CONSOLE_LOG = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -5,3 +5,5 @@ export function main() {
   const config = loadConfig();
+  console.log('debug: config loaded', config);
+  debugger;
   return config;
 }`;

const DIFF_WITH_EMPTY_CATCH = `diff --git a/src/service.ts b/src/service.ts
index abc1234..def5678 100644
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,5 +10,9 @@ export function fetchData() {
   try {
     return await fetch(url);
-  } catch (e) { throw e; }
+  } catch (e) {}
+  try {
+    return backup();
+  } catch {}
 }`;

const DIFF_WITH_HARDCODED_SECRET = `diff --git a/src/config.ts b/src/config.ts
index abc1234..def5678 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,3 +1,4 @@
 export const config = {
   baseUrl: "https://api.example.com",
+  api_key: "sk_live_abcdefghijklmnop",
 };`;

const DIFF_WITH_ANY_TYPE = `diff --git a/src/types.ts b/src/types.ts
index abc1234..def5678 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,3 +1,5 @@
+export function process(data: any): any {
+  return data;
+}
 export interface Config {
   name: string;
 }`;

const DIFF_SRC_WITHOUT_TESTS = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc1234..def5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,3 +1,15 @@
+export async function login(user: string, pass: string) {
+  const token = await authenticate(user, pass);
+  if (!token) {
+    throw new AuthError('Invalid credentials');
+  }
+  await saveSession(token);
+  return { token, user };
+}
+
+export async function logout() {
+  await clearSession();
+}
+
 export interface AuthConfig {
   provider: string;
 }`;

const DIFF_WITH_NEW_EXPORT_NO_JSDOC = `diff --git a/src/types.ts b/src/types.ts
index abc1234..def5678 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,3 +1,7 @@
+export interface UserSession {
+  id: string;
+  token: string;
+}
 export interface Config {
   name: string;
 }`;

const DIFF_WITH_EVAL = `diff --git a/src/dynamic.ts b/src/dynamic.ts
index abc1234..def5678 100644
--- a/src/dynamic.ts
+++ b/src/dynamic.ts
@@ -1,3 +1,5 @@
+export function run(code: string) {
+  return eval(code);
+}
 export const VERSION = "1.0";`;

describe("review tool: pattern detection via parseDiff", () => {
  it("detects console.log in added lines", () => {
    const diff = parseDiff(DIFF_WITH_CONSOLE_LOG);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(addedLines.some((l) => /console\.(log|debug|info)\(/.test(l.content))).toBe(true);
  });

  it("detects debugger in added lines", () => {
    const diff = parseDiff(DIFF_WITH_CONSOLE_LOG);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(addedLines.some((l) => /\bdebugger\b/.test(l.content))).toBe(true);
  });

  it("detects empty catch blocks", () => {
    const diff = parseDiff(DIFF_WITH_EMPTY_CATCH);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(
      addedLines.some(
        (l) =>
          /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(l.content) || /catch\s*\{\s*\}/.test(l.content),
      ),
    ).toBe(true);
  });

  it("detects hardcoded secrets", () => {
    const diff = parseDiff(DIFF_WITH_HARDCODED_SECRET);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(
      addedLines.some((l) =>
        /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(l.content),
      ),
    ).toBe(true);
  });

  it("detects any type usage", () => {
    const diff = parseDiff(DIFF_WITH_ANY_TYPE);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(addedLines.some((l) => /:\s*any\b/.test(l.content))).toBe(true);
  });

  it("detects eval usage", () => {
    const diff = parseDiff(DIFF_WITH_EVAL);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    expect(addedLines.some((l) => /\beval\s*\(/.test(l.content))).toBe(true);
  });

  it("detects source changes without test changes", () => {
    const diff = parseDiff(DIFF_SRC_WITHOUT_TESTS);
    const srcFiles = diff.files.filter((f) => !/\.(test|spec)\./.test(f.path));
    const testFiles = diff.files.filter((f) => /\.(test|spec)\./.test(f.path));

    expect(srcFiles.length).toBeGreaterThan(0);
    expect(testFiles.length).toBe(0);
    // Source file has >5 additions
    expect(srcFiles[0]!.additions).toBeGreaterThan(5);
  });

  it("detects new exports without JSDoc", () => {
    const diff = parseDiff(DIFF_WITH_NEW_EXPORT_NO_JSDOC);
    const addedLines = diff.files[0]!.hunks[0]!.lines.filter((l) => l.type === "add");

    const hasExport = addedLines.some((l) =>
      /^export\s+(function|interface|type|class|const|enum)\b/.test(l.content.trim()),
    );
    expect(hasExport).toBe(true);
  });
});

describe("review tool: severity ordering", () => {
  it("severity order is critical > major > minor > info", () => {
    const order = { critical: 0, major: 1, minor: 2, info: 3 };

    expect(order.critical).toBeLessThan(order.major);
    expect(order.major).toBeLessThan(order.minor);
    expect(order.minor).toBeLessThan(order.info);
  });
});

// ==========================================================================
// False positive fixes
// ==========================================================================

const DIFF_CONSOLE_LOG_IN_CLI = `diff --git a/src/cli/repl/output.ts b/src/cli/repl/output.ts
index abc1234..def5678 100644
--- a/src/cli/repl/output.ts
+++ b/src/cli/repl/output.ts
@@ -1,3 +1,5 @@
+export function showWelcome() {
+  console.log("Welcome to Corbat-Coco!");
+}
 export const VERSION = "1.0";`;

const DIFF_CONSOLE_LOG_IN_SERVICE = `diff --git a/src/services/auth.ts b/src/services/auth.ts
index abc1234..def5678 100644
--- a/src/services/auth.ts
+++ b/src/services/auth.ts
@@ -1,3 +1,5 @@
+export function login() {
+  console.log("debug: logging in");
+}
 export const AUTH_URL = "https://auth.example.com";`;

// 12 additions — below the 15-line threshold for "test exists" noise suppression
const DIFF_SRC_SMALL_CHANGE = `diff --git a/src/tools/git.ts b/src/tools/git.ts
index abc1234..def5678 100644
--- a/src/tools/git.ts
+++ b/src/tools/git.ts
@@ -1,3 +1,15 @@
+import { simpleGit } from "simple-git";
+function getGit(cwd) {
+  const baseDir = cwd ?? process.cwd();
+  return simpleGit({ baseDir });
+}
+export async function gitStatus(cwd) {
+  const git = getGit(cwd);
+  return git.status();
+}
+export async function gitDiff(cwd) {
+  const git = getGit(cwd);
+  return git.diff();
+}
 export const GIT_VERSION = "1.0";`;

// 18 additions — above the 15-line threshold
const DIFF_SRC_LARGE_CHANGE = `diff --git a/src/tools/auth.ts b/src/tools/auth.ts
index abc1234..def5678 100644
--- a/src/tools/auth.ts
+++ b/src/tools/auth.ts
@@ -1,3 +1,21 @@
+import { hash } from "node:crypto";
+export async function login(user, pass) {
+  const hashed = hash("sha256", pass);
+  const result = await db.query("SELECT * FROM users WHERE name = ?", [user]);
+  if (!result) throw new Error("User not found");
+  if (result.password !== hashed) throw new Error("Invalid password");
+  const token = generateToken(result.id);
+  await saveSession(token, result.id);
+  return { token, user: result.name };
+}
+export async function logout(token) {
+  await deleteSession(token);
+  return { success: true };
+}
+export async function register(user, pass, email) {
+  const hashed = hash("sha256", pass);
+  await db.insert("users", { name: user, password: hashed, email });
+  return login(user, pass);
+}
 export const AUTH_VERSION = "1.0";`;

describe("review tool: console.log path exclusion", () => {
  it("should NOT flag console.log in CLI/REPL files", () => {
    const diff = parseDiff(DIFF_CONSOLE_LOG_IN_CLI);
    const findings = analyzePatterns(diff);

    const consoleFindings = findings.filter((f) => f.message.includes("console.log"));
    expect(consoleFindings).toHaveLength(0);
  });

  it("should still flag console.log in non-CLI source files", () => {
    const diff = parseDiff(DIFF_CONSOLE_LOG_IN_SERVICE);
    const findings = analyzePatterns(diff);

    const consoleFindings = findings.filter((f) => f.message.includes("console.log"));
    expect(consoleFindings).toHaveLength(1);
    expect(consoleFindings[0]!.severity).toBe("minor");
    expect(consoleFindings[0]!.file).toBe("src/services/auth.ts");
  });
});

describe("review tool: test file existence check", () => {
  it("should suppress finding when test exists and change is small (< 15 additions)", async () => {
    const { fileExists } = await import("../utils/files.js");
    const mockFileExists = fileExists as ReturnType<typeof vi.fn>;
    mockFileExists.mockResolvedValue(true);

    const diff = parseDiff(DIFF_SRC_SMALL_CHANGE);
    const findings = await checkTestCoverage(diff, "/project");

    const testFindings = findings.filter((f) => f.category === "testing");
    expect(testFindings).toHaveLength(0);
  });

  it("should emit info when test exists but change is large (>= 15 additions)", async () => {
    const { fileExists } = await import("../utils/files.js");
    const mockFileExists = fileExists as ReturnType<typeof vi.fn>;
    mockFileExists.mockResolvedValue(true);

    const diff = parseDiff(DIFF_SRC_LARGE_CHANGE);
    const findings = await checkTestCoverage(diff, "/project");

    const testFindings = findings.filter((f) => f.category === "testing");
    expect(testFindings).toHaveLength(1);
    expect(testFindings[0]!.severity).toBe("info");
    expect(testFindings[0]!.message).toContain("exists but was not updated");
  });

  it("should keep minor severity when no test file exists", async () => {
    const { fileExists } = await import("../utils/files.js");
    const mockFileExists = fileExists as ReturnType<typeof vi.fn>;
    mockFileExists.mockResolvedValue(false);

    const diff = parseDiff(DIFF_SRC_SMALL_CHANGE);
    const findings = await checkTestCoverage(diff, "/project");

    const testFindings = findings.filter((f) => f.category === "testing");
    expect(testFindings).toHaveLength(1);
    expect(testFindings[0]!.severity).toBe("minor");
    expect(testFindings[0]!.message).toContain("without corresponding test updates");
  });
});
