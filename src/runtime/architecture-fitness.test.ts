import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "@typescript-eslint/typescript-estree";
import { describe, expect, it } from "vitest";
import ts from "typescript";

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
    const allowed = new Set([join(SRC_ROOT, "runtime", "runtime-tool-executor.ts")]);
    const configPath = join(process.cwd(), "tsconfig.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const violations = registryDispatchReferences(
      program,
      join(SRC_ROOT, "tools", "registry.ts"),
    ).filter(({ file }) => file.startsWith(SRC_ROOT) && !allowed.has(file));
    expect(
      violations.map(({ file, text }) => `${relative(process.cwd(), file)}: ${text}`).sort(),
    ).toEqual([]);
  });
});

/** Resolve the actual method symbol, rather than depending on a variable name. */
function registryDispatchReferences(
  program: ts.Program,
  registryFile: string,
): Array<{ file: string; text: string }> {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(registryFile);
  if (!source) throw new Error(`Registry source not found: ${registryFile}`);
  const registry = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === "ToolRegistry",
  );
  const method = registry?.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "execute",
  );
  if (!method) throw new Error("ToolRegistry.execute declaration not found");
  const references: Array<{ file: string; text: string }> = [];
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || file.fileName.endsWith(".test.ts")) continue;
    const visit = (node: ts.Node): void => {
      let symbol: ts.Symbol | undefined;
      if (ts.isPropertyAccessExpression(node)) {
        symbol = checker.getSymbolAtLocation(node.name);
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        symbol = checker
          .getTypeAtLocation(node.expression)
          .getProperty(node.argumentExpression.text);
      } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const name = node.propertyName ?? node.name;
        if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
          symbol = checker.getTypeAtLocation(node.parent).getProperty(name.text);
        }
      }
      if (symbol?.declarations?.includes(method))
        references.push({ file: file.fileName, text: node.getText(file) });
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return references;
}

describe("tool boundary detector", () => {
  it("recognizes imported aliases, reassignment, indexed access and extracted methods without flagging other executors", () => {
    const registry = "/fixture/registry.ts";
    const consumer = "/fixture/consumer.ts";
    const sources = new Map([
      [registry, "export class ToolRegistry { execute() {} }"],
      [
        consumer,
        `
        import { ToolRegistry as Renamed } from "./registry.js";
        const registry = new Renamed();
        const alias = registry;
        alias.execute();
        registry["execute"]();
        const { execute: run } = alias;
        const extracted = alias.execute.bind(alias);
        function invoke(other: Renamed) { other.execute(); }
        class Other { execute() {} }
        new Other().execute();
        const unrelated = "toolRegistry.execute";
      `,
      ],
    ]);
    const options: ts.CompilerOptions = {
      noLib: true,
      types: [],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    };
    const host = ts.createCompilerHost(options);
    host.fileExists = (file) => sources.has(file);
    host.readFile = (file) => sources.get(file);
    host.directoryExists = (dir) => dir === "/fixture";
    host.getSourceFile = (file, version) => {
      const content = sources.get(file);
      return content === undefined ? undefined : ts.createSourceFile(file, content, version, true);
    };
    const program = ts.createProgram([registry, consumer], options, host);
    expect(registryDispatchReferences(program, registry).map(({ text }) => text)).toEqual([
      "alias.execute",
      'registry["execute"]',
      "execute: run",
      "alias.execute",
      "other.execute",
    ]);
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
