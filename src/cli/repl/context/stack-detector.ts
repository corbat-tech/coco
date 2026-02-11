/**
 * Stack Detector for REPL Context Enrichment
 *
 * Detects project technology stack at REPL startup to enrich LLM context.
 * Prevents COCO from suggesting incompatible technologies (e.g., npm in Java projects).
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileExists } from "../../../utils/files.js";

export type ProjectStack = "node" | "java" | "python" | "go" | "rust" | "unknown";

export interface ProjectStackContext {
  /** Primary language/runtime */
  stack: ProjectStack;
  /** Package manager (npm, pnpm, yarn, maven, gradle, cargo, pip, go) */
  packageManager: string | null;
  /** Key dependencies (name → version) */
  dependencies: Record<string, string>;
  /** Inferred frameworks (e.g., ["Spring Boot", "React", "FastAPI"]) */
  frameworks: string[];
  /** Build tools detected (e.g., ["gradle", "webpack", "vite"]) */
  buildTools: string[];
  /** Testing frameworks (e.g., ["junit", "vitest", "pytest"]) */
  testingFrameworks: string[];
  /** Languages detected (e.g., ["TypeScript", "Java", "Python"]) */
  languages: string[];
}

/**
 * Detect project stack type based on manifest files
 */
async function detectStack(cwd: string): Promise<ProjectStack> {
  if (await fileExists(path.join(cwd, "package.json"))) return "node";
  if (await fileExists(path.join(cwd, "Cargo.toml"))) return "rust";
  if (await fileExists(path.join(cwd, "pyproject.toml"))) return "python";
  if (await fileExists(path.join(cwd, "go.mod"))) return "go";
  if (await fileExists(path.join(cwd, "pom.xml"))) return "java";
  if (await fileExists(path.join(cwd, "build.gradle"))) return "java";
  if (await fileExists(path.join(cwd, "build.gradle.kts"))) return "java";
  return "unknown";
}

/**
 * Detect package manager based on lock files
 */
async function detectPackageManager(cwd: string, stack: ProjectStack): Promise<string | null> {
  if (stack === "rust") return "cargo";
  if (stack === "python") return "pip";
  if (stack === "go") return "go";

  if (stack === "java") {
    if (
      (await fileExists(path.join(cwd, "build.gradle"))) ||
      (await fileExists(path.join(cwd, "build.gradle.kts")))
    ) {
      return "gradle";
    }
    if (await fileExists(path.join(cwd, "pom.xml"))) {
      return "maven";
    }
  }

  if (stack === "node") {
    if (await fileExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (await fileExists(path.join(cwd, "yarn.lock"))) return "yarn";
    if (await fileExists(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
  }

  return null;
}

/**
 * Parse Node.js package.json and extract dependencies
 */
async function parsePackageJson(cwd: string): Promise<{
  dependencies: Record<string, string>;
  frameworks: string[];
  buildTools: string[];
  testingFrameworks: string[];
  languages: string[];
}> {
  const packageJsonPath = path.join(cwd, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Infer frameworks from dependencies
    const frameworks: string[] = [];
    if (allDeps.react) frameworks.push("React");
    if (allDeps.vue) frameworks.push("Vue");
    if (allDeps["@angular/core"]) frameworks.push("Angular");
    if (allDeps.next) frameworks.push("Next.js");
    if (allDeps.nuxt) frameworks.push("Nuxt");
    if (allDeps.express) frameworks.push("Express");
    if (allDeps.fastify) frameworks.push("Fastify");
    if (allDeps.nestjs || allDeps["@nestjs/core"]) frameworks.push("NestJS");

    // Infer build tools
    const buildTools: string[] = [];
    if (allDeps.webpack) buildTools.push("webpack");
    if (allDeps.vite) buildTools.push("vite");
    if (allDeps.rollup) buildTools.push("rollup");
    if (allDeps.tsup) buildTools.push("tsup");
    if (allDeps.esbuild) buildTools.push("esbuild");
    if (pkg.scripts?.build) buildTools.push("build");

    // Infer testing frameworks
    const testingFrameworks: string[] = [];
    if (allDeps.vitest) testingFrameworks.push("vitest");
    if (allDeps.jest) testingFrameworks.push("jest");
    if (allDeps.mocha) testingFrameworks.push("mocha");
    if (allDeps.chai) testingFrameworks.push("chai");
    if (allDeps["@playwright/test"]) testingFrameworks.push("playwright");
    if (allDeps.cypress) testingFrameworks.push("cypress");

    // Detect languages
    const languages: string[] = ["JavaScript"];
    if (allDeps.typescript || (await fileExists(path.join(cwd, "tsconfig.json")))) {
      languages.push("TypeScript");
    }

    return {
      dependencies: allDeps,
      frameworks,
      buildTools,
      testingFrameworks,
      languages,
    };
  } catch {
    return {
      dependencies: {},
      frameworks: [],
      buildTools: [],
      testingFrameworks: [],
      languages: [],
    };
  }
}

/**
 * Parse Java pom.xml and extract dependencies (basic parsing)
 */
async function parsePomXml(cwd: string): Promise<{
  dependencies: Record<string, string>;
  frameworks: string[];
  buildTools: string[];
  testingFrameworks: string[];
}> {
  const pomPath = path.join(cwd, "pom.xml");

  try {
    const content = await fs.readFile(pomPath, "utf-8");

    const dependencies: Record<string, string> = {};
    const frameworks: string[] = [];
    const buildTools: string[] = ["maven"];
    const testingFrameworks: string[] = [];

    // Simple regex-based parsing (not full XML parser)
    const depRegex = /<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g;
    let match;

    while ((match = depRegex.exec(content)) !== null) {
      const groupId = match[1];
      const artifactId = match[2];
      if (!groupId || !artifactId) continue;

      const fullName = `${groupId}:${artifactId}`;
      dependencies[fullName] = "unknown"; // Version parsing would require more complex logic

      // Infer frameworks
      if (artifactId.includes("spring-boot")) {
        if (!frameworks.includes("Spring Boot")) frameworks.push("Spring Boot");
      }
      if (artifactId.includes("spring-webmvc") || artifactId.includes("spring-web")) {
        if (!frameworks.includes("Spring MVC")) frameworks.push("Spring MVC");
      }
      if (artifactId.includes("hibernate")) {
        if (!frameworks.includes("Hibernate")) frameworks.push("Hibernate");
      }

      // Infer testing frameworks
      if (artifactId === "junit-jupiter" || artifactId === "junit") {
        if (!testingFrameworks.includes("JUnit")) testingFrameworks.push("JUnit");
      }
      if (artifactId === "mockito-core") {
        if (!testingFrameworks.includes("Mockito")) testingFrameworks.push("Mockito");
      }
    }

    return { dependencies, frameworks, buildTools, testingFrameworks };
  } catch {
    return { dependencies: {}, frameworks: [], buildTools: ["maven"], testingFrameworks: [] };
  }
}

/**
 * Parse Python pyproject.toml and extract dependencies (basic parsing)
 */
async function parsePyprojectToml(cwd: string): Promise<{
  dependencies: Record<string, string>;
  frameworks: string[];
  buildTools: string[];
  testingFrameworks: string[];
}> {
  const pyprojectPath = path.join(cwd, "pyproject.toml");

  try {
    const content = await fs.readFile(pyprojectPath, "utf-8");

    const dependencies: Record<string, string> = {};
    const frameworks: string[] = [];
    const buildTools: string[] = ["pip"];
    const testingFrameworks: string[] = [];

    // Simple line-based parsing
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse dependencies (very basic)
      if (trimmed.match(/^["']?[\w-]+["']?\s*=\s*["'][\^~>=<]+[\d.]+["']/)) {
        const depMatch = trimmed.match(/^["']?([\w-]+)["']?\s*=\s*["']([\^~>=<]+[\d.]+)["']/);
        if (depMatch && depMatch[1] && depMatch[2]) {
          dependencies[depMatch[1]] = depMatch[2];
        }
      }

      // Infer frameworks
      if (trimmed.includes("fastapi")) frameworks.push("FastAPI");
      if (trimmed.includes("django")) frameworks.push("Django");
      if (trimmed.includes("flask")) frameworks.push("Flask");

      // Infer testing frameworks
      if (trimmed.includes("pytest")) testingFrameworks.push("pytest");
      if (trimmed.includes("unittest")) testingFrameworks.push("unittest");
    }

    return { dependencies, frameworks, buildTools, testingFrameworks };
  } catch {
    return { dependencies: {}, frameworks: [], buildTools: ["pip"], testingFrameworks: [] };
  }
}

/**
 * Main entry point: Detect project stack and enrich with dependencies
 */
export async function detectProjectStack(cwd: string): Promise<ProjectStackContext> {
  const stack = await detectStack(cwd);
  const packageManager = await detectPackageManager(cwd, stack);

  let dependencies: Record<string, string> = {};
  let frameworks: string[] = [];
  let buildTools: string[] = [];
  let testingFrameworks: string[] = [];
  let languages: string[] = [];

  // Parse dependencies based on stack
  if (stack === "node") {
    const parsed = await parsePackageJson(cwd);
    dependencies = parsed.dependencies;
    frameworks = parsed.frameworks;
    buildTools = parsed.buildTools;
    testingFrameworks = parsed.testingFrameworks;
    languages = parsed.languages;
  } else if (stack === "java") {
    const parsed = await parsePomXml(cwd);
    dependencies = parsed.dependencies;
    frameworks = parsed.frameworks;
    buildTools = parsed.buildTools;
    testingFrameworks = parsed.testingFrameworks;
    languages = ["Java"];
  } else if (stack === "python") {
    const parsed = await parsePyprojectToml(cwd);
    dependencies = parsed.dependencies;
    frameworks = parsed.frameworks;
    buildTools = parsed.buildTools;
    testingFrameworks = parsed.testingFrameworks;
    languages = ["Python"];
  } else if (stack === "go") {
    languages = ["Go"];
    buildTools = ["go"];
  } else if (stack === "rust") {
    languages = ["Rust"];
    buildTools = ["cargo"];
  }

  return {
    stack,
    packageManager,
    dependencies,
    frameworks,
    buildTools,
    testingFrameworks,
    languages,
  };
}
