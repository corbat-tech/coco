/**
 * Tests for diff renderer
 */

import { describe, it, expect } from "vitest";
import { parseDiff, getChangedLines } from "./diff-renderer.js";

const SIMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,8 @@ export function main() {
   const config = loadConfig();
   if (!config) {
-    throw new Error('No config');
+    logger.error('Config missing');
+    throw new ConfigError('No config');
   }
   return config;
 }`;

const NEW_FILE_DIFF = `diff --git a/src/utils/helper.ts b/src/utils/helper.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/utils/helper.ts
@@ -0,0 +1,5 @@
+export function helper() {
+  return 42;
+}
+
+export const NAME = "helper";`;

const DELETED_FILE_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return "deprecated";
-}`;

const RENAME_DIFF = `diff --git a/src/foo.ts b/src/bar.ts
similarity index 90%
rename from src/foo.ts
rename to src/bar.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/bar.ts
@@ -1,3 +1,3 @@
-export function foo() {
+export function bar() {
   return true;
 }`;

const MULTI_HUNK_DIFF = `diff --git a/src/main.ts b/src/main.ts
index abc1234..def5678 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -5,6 +5,7 @@ import { config } from "./config";
 const app = createApp();

+app.use(cors());
 app.use(bodyParser());
 app.use(router());

@@ -20,4 +21,5 @@ app.listen(3000, () => {
   console.log("Running");
 });

+// Graceful shutdown
+process.on("SIGTERM", () => app.close());`;

describe("parseDiff", () => {
  it("parses a simple modification diff", () => {
    const result = parseDiff(SIMPLE_DIFF);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/app.ts");
    expect(result.files[0]!.type).toBe("modified");
    expect(result.files[0]!.additions).toBe(2);
    expect(result.files[0]!.deletions).toBe(1);
    expect(result.files[0]!.hunks).toHaveLength(1);

    const hunk = result.files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(10);
    expect(hunk.newStart).toBe(10);

    // Check line types
    const addLines = hunk.lines.filter((l) => l.type === "add");
    const deleteLines = hunk.lines.filter((l) => l.type === "delete");
    const contextLines = hunk.lines.filter((l) => l.type === "context");

    expect(addLines).toHaveLength(2);
    expect(deleteLines).toHaveLength(1);
    expect(contextLines).toHaveLength(5);
  });

  it("parses a new file diff", () => {
    const result = parseDiff(NEW_FILE_DIFF);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/utils/helper.ts");
    expect(result.files[0]!.type).toBe("added");
    expect(result.files[0]!.additions).toBe(5);
    expect(result.files[0]!.deletions).toBe(0);
  });

  it("parses a deleted file diff", () => {
    const result = parseDiff(DELETED_FILE_DIFF);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/old.ts");
    expect(result.files[0]!.type).toBe("deleted");
    expect(result.files[0]!.additions).toBe(0);
    expect(result.files[0]!.deletions).toBe(3);
  });

  it("parses a rename diff", () => {
    const result = parseDiff(RENAME_DIFF);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe("src/bar.ts");
    expect(result.files[0]!.oldPath).toBe("src/foo.ts");
    expect(result.files[0]!.type).toBe("renamed");
  });

  it("parses multi-hunk diff", () => {
    const result = parseDiff(MULTI_HUNK_DIFF);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.hunks).toHaveLength(2);
    expect(result.files[0]!.additions).toBe(3);
  });

  it("parses multiple files", () => {
    const combined = SIMPLE_DIFF + "\n" + NEW_FILE_DIFF;
    const result = parseDiff(combined);

    expect(result.files).toHaveLength(2);
    expect(result.stats.filesChanged).toBe(2);
    expect(result.stats.additions).toBe(7);
    expect(result.stats.deletions).toBe(1);
  });

  it("handles empty diff", () => {
    const result = parseDiff("");

    expect(result.files).toHaveLength(0);
    expect(result.stats.filesChanged).toBe(0);
    expect(result.stats.additions).toBe(0);
    expect(result.stats.deletions).toBe(0);
  });

  it("assigns correct line numbers", () => {
    const result = parseDiff(SIMPLE_DIFF);
    const hunk = result.files[0]!.hunks[0]!;

    // First context line should be line 10
    const firstContext = hunk.lines.find((l) => l.type === "context");
    expect(firstContext!.newLineNo).toBe(10);

    // Delete line should reference old line number
    const deleteLine = hunk.lines.find((l) => l.type === "delete");
    expect(deleteLine!.oldLineNo).toBe(12);

    // First add line
    const addLine = hunk.lines.find((l) => l.type === "add");
    expect(addLine!.newLineNo).toBe(12);
  });
});

describe("getChangedLines", () => {
  it("returns changed line numbers per file", () => {
    const diff = parseDiff(SIMPLE_DIFF);
    const changed = getChangedLines(diff);

    expect(changed.has("src/app.ts")).toBe(true);
    const lines = changed.get("src/app.ts")!;
    expect(lines.has(12)).toBe(true);
    expect(lines.has(13)).toBe(true);
    expect(lines.size).toBe(2);
  });

  it("handles new files", () => {
    const diff = parseDiff(NEW_FILE_DIFF);
    const changed = getChangedLines(diff);

    const lines = changed.get("src/utils/helper.ts")!;
    expect(lines.size).toBe(5);
    expect(lines.has(1)).toBe(true);
    expect(lines.has(5)).toBe(true);
  });

  it("excludes deleted files (no new lines)", () => {
    const diff = parseDiff(DELETED_FILE_DIFF);
    const changed = getChangedLines(diff);

    // Deleted files have no added lines
    expect(changed.has("src/old.ts")).toBe(false);
  });
});
