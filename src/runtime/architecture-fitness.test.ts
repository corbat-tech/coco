import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");

describe("architecture fitness", () => {
  it("keeps runtime independent from CLI, REPL, and swarm implementations", () => {
    const violations = findImports(join(SRC_ROOT, "runtime")).filter(
      (entry) =>
        /from\s+["']\.\.\/(?:cli|swarm)\//.test(entry.content) ||
        /from\s+["']\.\.\/cli\//.test(entry.content),
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps swarm from importing CLI or REPL internals", () => {
    const violations = findImports(join(SRC_ROOT, "swarm")).filter(
      (entry) =>
        /from\s+["']\.\.\/cli\//.test(entry.content) ||
        /from\s+["']\.\.\/cli\/repl\//.test(entry.content),
    );

    expect(formatViolations(violations)).toEqual([]);
  });
});

function findImports(root: string): Array<{ file: string; content: string }> {
  const entries: Array<{ file: string; content: string }> = [];
  for (const file of listFiles(root)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const content = readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.includes(" from "))
      .join("\n");
    entries.push({ file, content });
  }
  return entries;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function formatViolations(violations: Array<{ file: string; content: string }>): string[] {
  return violations.map((violation) => relative(process.cwd(), violation.file)).sort();
}
