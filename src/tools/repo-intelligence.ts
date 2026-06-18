/**
 * Repo intelligence graph and ranked context retrieval.
 *
 * This builds on codebase_map and adds a lightweight, cacheable ranking layer
 * for agent context selection.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { codebaseMapTool, type CodebaseMapOutput, type FileMapEntry } from "./codebase-map.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");

export interface RepoGraphNode extends FileMapEntry {
  inboundImports: number;
  testRelated: boolean;
}

export interface RepoIntelligenceGraph {
  root: string;
  generatedAt: string;
  files: RepoGraphNode[];
  summary: CodebaseMapOutput["summary"];
}

export interface RepoContextRequest {
  path?: string;
  query: string;
  budget?: number;
  mode?: "ask" | "plan" | "build" | "debug" | "review" | "architect";
  changedFiles?: string[];
  refresh?: boolean;
}

export interface RankedContextItem {
  path: string;
  score: number;
  reasons: string[];
  language: string;
  lineCount: number;
  definitions: FileMapEntry["definitions"];
  imports: string[];
  exports: string[];
}

export interface RepoContextResult {
  graph: {
    root: string;
    generatedAt: string;
    totalFiles: number;
    totalDefinitions: number;
  };
  query: string;
  budget: number;
  items: RankedContextItem[];
}

function cachePath(root: string): string {
  return path.join(root, ".coco", "cache", "repo-index.json");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_./:-]+/g, " ");
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      normalizeText(query)
        .split(/\s+/)
        .filter((term) => term.length >= 2),
    ),
  ];
}

function importTargetToPath(importTarget: string): string {
  return importTarget.replace(/^\.\//, "").replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
}

function buildGraph(root: string, map: CodebaseMapOutput): RepoIntelligenceGraph {
  const inbound = new Map<string, number>();
  const files = new Set(map.files.map((file) => file.path.replace(/\.[^.]+$/, "")));

  for (const file of map.files) {
    for (const importTarget of file.imports) {
      const normalized = importTargetToPath(importTarget);
      for (const candidate of files) {
        if (candidate.endsWith(normalized) || normalized.endsWith(candidate)) {
          inbound.set(candidate, (inbound.get(candidate) ?? 0) + 1);
        }
      }
    }
  }

  return {
    root,
    generatedAt: new Date().toISOString(),
    files: map.files.map((file) => {
      const withoutExt = file.path.replace(/\.[^.]+$/, "");
      return {
        ...file,
        inboundImports: inbound.get(withoutExt) ?? 0,
        testRelated: /(?:^|[/.-])(test|spec|__tests__)(?:[/.-]|$)/i.test(file.path),
      };
    }),
    summary: map.summary,
  };
}

async function readCachedGraph(root: string): Promise<RepoIntelligenceGraph | null> {
  try {
    const raw = await fs.readFile(cachePath(root), "utf-8");
    return JSON.parse(raw) as RepoIntelligenceGraph;
  } catch {
    return null;
  }
}

async function writeCachedGraph(root: string, graph: RepoIntelligenceGraph): Promise<void> {
  const file = cachePath(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(graph, null, 2) + "\n", "utf-8");
}

async function loadGraph(root: string, refresh: boolean): Promise<RepoIntelligenceGraph> {
  if (!refresh) {
    const cached = await readCachedGraph(root);
    if (cached) return cached;
  }

  const map = await codebaseMapTool.execute({
    path: root,
    maxFiles: 500,
    depth: "detailed",
    includeTests: true,
  });
  const graph = buildGraph(root, map);
  await writeCachedGraph(root, graph);
  return graph;
}

function scoreFile(
  file: RepoGraphNode,
  terms: string[],
  mode: RepoContextRequest["mode"],
  changedFiles: Set<string>,
): RankedContextItem {
  let score = 0;
  const reasons: string[] = [];
  const pathText = normalizeText(file.path);
  const symbolText = normalizeText(file.definitions.map((def) => def.name).join(" "));
  const importText = normalizeText([...file.imports, ...file.exports].join(" "));

  for (const term of terms) {
    if (pathText.includes(term)) {
      score += 8;
      reasons.push(`path:${term}`);
    }
    if (symbolText.includes(term)) {
      score += 6;
      reasons.push(`symbol:${term}`);
    }
    if (importText.includes(term)) {
      score += 3;
      reasons.push(`import/export:${term}`);
    }
  }

  if (changedFiles.has(file.path)) {
    score += 10;
    reasons.push("changed-file");
  }

  if (file.inboundImports > 0) {
    score += Math.min(6, file.inboundImports);
    reasons.push(`centrality:${file.inboundImports}`);
  }

  if ((mode === "debug" || mode === "review") && file.testRelated) {
    score += 4;
    reasons.push("test-related");
  }

  if (file.exports.length > 0) {
    score += 1;
  }

  return {
    path: file.path,
    score,
    reasons: [...new Set(reasons)],
    language: file.language,
    lineCount: file.lineCount,
    definitions: file.definitions.slice(0, 20),
    imports: file.imports.slice(0, 20),
    exports: file.exports.slice(0, 20),
  };
}

export async function getRepoContext(request: RepoContextRequest): Promise<RepoContextResult> {
  const root = path.resolve(request.path ?? ".");
  const budget = request.budget ?? 12;
  const graph = await loadGraph(root, request.refresh ?? false);
  const terms = queryTerms(request.query);
  const changedFiles = new Set(request.changedFiles ?? []);

  const items = graph.files
    .map((file) => scoreFile(file, terms, request.mode, changedFiles))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, budget);

  return {
    graph: {
      root: graph.root,
      generatedAt: graph.generatedAt,
      totalFiles: graph.summary.totalFiles,
      totalDefinitions: graph.summary.totalDefinitions,
    },
    query: request.query,
    budget,
    items,
  };
}

export async function repoContext(request: RepoContextRequest): Promise<RepoContextResult> {
  return getRepoContext(request);
}

export const repoContextTool: ToolDefinition<RepoContextRequest, RepoContextResult> = defineTool({
  name: "repo_context",
  description:
    "Return ranked, token-efficient repository context for a task using symbols, imports, tests, and centrality.",
  category: "search",
  parameters: z.object({
    path: z.string().optional().default(".").describe("Repository root"),
    query: z.string().min(1).describe("Task or search query to rank files against"),
    budget: z.number().min(1).max(50).optional().default(12).describe("Maximum files to return"),
    mode: z
      .enum(["ask", "plan", "build", "debug", "review", "architect"])
      .optional()
      .describe("Agent mode to bias ranking"),
    changedFiles: z.array(z.string()).optional().describe("Files already changed or selected"),
    refresh: z.boolean().optional().default(false).describe("Refresh persistent repo index cache"),
  }),
  execute: getRepoContext,
});

export const repoIntelligenceTools = [repoContextTool];
