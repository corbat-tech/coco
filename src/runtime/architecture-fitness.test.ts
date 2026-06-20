import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "@typescript-eslint/typescript-estree";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");

describe("architecture fitness", () => {
  it("keeps runtime independent from CLI, REPL, and swarm implementations", () => {
    const violations = findImports(join(SRC_ROOT, "runtime")).filter((entry) =>
      importsForbiddenRuntimePath(entry),
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps swarm from importing CLI or REPL internals", () => {
    const violations = findImports(join(SRC_ROOT, "swarm")).filter((entry) =>
      entry.imports.some(
        (source) =>
          resolveImport(entry.file, source).startsWith(join(SRC_ROOT, "cli")) ||
          resolveImport(entry.file, source).startsWith(join(SRC_ROOT, "cli", "repl")),
      ),
    );

    expect(formatViolations(violations)).toEqual([]);
  });

  it("keeps direct tool execution inside runtime tool execution boundaries", () => {
    const allowed = new Set([
      join(SRC_ROOT, "runtime", "agent-runtime.ts"),
      join(SRC_ROOT, "runtime", "runtime-tool-executor.ts"),
    ]);
    const violations = listFiles(SRC_ROOT).filter((file) => {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) return false;
      if (allowed.has(file)) return false;
      return readFileSync(file, "utf-8").includes("toolRegistry.execute");
    });

    expect(violations.map((file) => relative(process.cwd(), file)).sort()).toEqual([]);
  });
});

function findImports(root: string): Array<{ file: string; imports: string[] }> {
  const entries: Array<{ file: string; imports: string[] }> = [];
  for (const file of listFiles(root)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    entries.push({ file, imports: extractImports(readFileSync(file, "utf-8")) });
  }
  return entries;
}

function extractImports(content: string): string[] {
  const ast = parse(content, { loc: false, range: false });
  return ast.body
    .filter((node) => node.type === "ImportDeclaration")
    .map((node) => node.source.value)
    .filter((source): source is string => typeof source === "string");
}

function importsForbiddenRuntimePath(entry: { file: string; imports: string[] }): boolean {
  return entry.imports.some((source) => {
    const resolved = resolveImport(entry.file, source);
    return (
      resolved.startsWith(join(SRC_ROOT, "cli")) ||
      resolved.startsWith(join(SRC_ROOT, "swarm")) ||
      resolved.startsWith(join(SRC_ROOT, "agents"))
    );
  });
}

function resolveImport(file: string, source: string): string {
  if (!source.startsWith(".")) return source;
  return join(dirname(file), source).replace(/\.js$/, ".ts");
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

function formatViolations(violations: Array<{ file: string }>): string[] {
  return violations.map((violation) => relative(process.cwd(), violation.file)).sort();
}
