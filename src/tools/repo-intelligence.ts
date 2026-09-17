/**
 * Repo intelligence graph and ranked context retrieval.
 *
 * This builds on codebase_map and adds a lightweight, cacheable ranking layer
 * for agent context selection.
 */

import { createHash, randomUUID } from "node:crypto";
import { glob } from "glob";
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import {
  codebaseMapTool,
  LANGUAGE_EXTENSIONS,
  DEFAULT_EXCLUDES,
  type CodebaseMapOutput,
  type FileMapEntry,
} from "./codebase-map.js";

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
  /** Conservative estimated token cap for ranked items, independent of file count. */
  tokenBudget?: number;
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
  tokenBudget: number;
  estimatedTokens: number;
  tokenEstimate: "utf8-byte-upper-bound";
  omittedItems: number;
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
      if (!importTarget.startsWith(".")) continue;
      const normalized = importTargetToPath(
        path.posix.normalize(path.posix.join(path.posix.dirname(file.path), importTarget)),
      );
      const candidate = files.has(normalized)
        ? normalized
        : files.has(`${normalized}/index`)
          ? `${normalized}/index`
          : undefined;
      if (candidate) inbound.set(candidate, (inbound.get(candidate) ?? 0) + 1);
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

const DefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(["class", "function", "interface", "type", "enum", "const", "variable", "method"]),
  line: z.number().int().min(1),
  exported: z.boolean(),
  signature: z.string().optional(),
});
const GraphSchema = z.object({
  root: z.string(),
  generatedAt: z.string(),
  files: z
    .array(
      z.object({
        path: z.string(),
        language: z.string(),
        definitions: z.array(DefinitionSchema),
        imports: z.array(z.string()),
        exports: z.array(z.string()),
        lineCount: z.number().int().nonnegative(),
        inboundImports: z.number().int().nonnegative(),
        testRelated: z.boolean(),
      }),
    )
    .max(500),
  summary: z.object({
    totalFiles: z.number().int().nonnegative(),
    totalDefinitions: z.number().int().nonnegative(),
    languages: z.record(z.string(), z.number().int().nonnegative()),
    exportedSymbols: z.number().int().nonnegative(),
  }),
});
const CacheSchema = z.object({
  version: z.literal(2),
  fingerprint: z.string(),
  graph: GraphSchema,
});

/** Bound index work to the same deterministic file set as codebase_map. */
async function fingerprint(root: string): Promise<string> {
  const extensions = Object.values(LANGUAGE_EXTENSIONS).flat();
  const files = (
    await glob(`**/*{${extensions.join(",")}}`, {
      cwd: root,
      nodir: true,
      follow: false,
      ignore: DEFAULT_EXCLUDES.filter(
        (pattern) => !pattern.includes("*.test.") && !pattern.includes("*.spec."),
      ),
    })
  ).sort();
  // All names detect additions/deletions that move files into the indexed window.
  const digest = createHash("sha256").update(JSON.stringify(files));
  for (const file of files.slice(0, 500)) {
    const absolute = path.join(root, file);
    const real = await fs.realpath(absolute);
    const relative = path.relative(root, real);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("Repository index source resolves outside the project");
    const stat = await fs.stat(real, { bigint: true });
    digest.update(
      JSON.stringify([
        file,
        real,
        stat.size.toString(),
        stat.mtimeNs.toString(),
        stat.ctimeNs.toString(),
        stat.ino.toString(),
      ]),
    );
  }
  for (const file of ["package.json", "tsconfig.json", ".gitignore", ".coco.config.json"]) {
    const stat = await fs
      .stat(path.join(root, file), { bigint: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    digest.update(
      JSON.stringify([
        file,
        stat?.size.toString(),
        stat?.mtimeNs.toString(),
        stat?.ctimeNs.toString(),
      ]),
    );
  }
  return digest.digest("hex");
}

/** Optional cache must never follow project-controlled links outside its directory. */
async function safeCache(root: string, create: boolean): Promise<boolean> {
  try {
    for (const directory of [path.join(root, ".coco"), path.join(root, ".coco", "cache")]) {
      let info = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!info && create) {
        await fs.mkdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
        info = await fs.lstat(directory);
      }
      if (
        !info?.isDirectory() ||
        info.isSymbolicLink() ||
        (await fs.realpath(directory)) !== directory
      )
        return false;
    }
    const leaf = await fs.lstat(cachePath(root)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    return !leaf || (leaf.isFile() && !leaf.isSymbolicLink() && leaf.nlink === 1);
  } catch {
    return false;
  }
}

async function readCachedGraph(
  root: string,
  currentFingerprint: string,
): Promise<RepoIntelligenceGraph | null> {
  try {
    if (!(await safeCache(root, false))) return null;
    const file = cachePath(root);
    if ((await fs.stat(file)).size > 16 * 1024 * 1024) return null;
    const parsed = CacheSchema.safeParse(JSON.parse(await fs.readFile(file, "utf-8")));
    if (
      !parsed.success ||
      parsed.data.fingerprint !== currentFingerprint ||
      parsed.data.graph.root !== root
    )
      return null;
    if (
      parsed.data.graph.files.some(
        (file) => path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes(".."),
      )
    )
      return null;
    return parsed.data.graph;
  } catch {
    return null;
  }
}

async function loadGraph(root: string, refresh: boolean): Promise<RepoIntelligenceGraph> {
  const before = await fingerprint(root);
  if (!refresh) {
    const cached = await readCachedGraph(root, before);
    if (cached) return cached;
  }
  const map = await codebaseMapTool.execute({
    path: root,
    maxFiles: 500,
    depth: "detailed",
    includeTests: true,
  });
  if (before !== (await fingerprint(root)))
    throw new Error("Repository changed while indexing; retry for current context");
  const graph = buildGraph(root, map);
  if (await safeCache(root, true)) {
    const temporary = path.join(path.dirname(cachePath(root)), `.repo-index-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify({ version: 2, fingerprint: before, graph }) + "\n",
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      if (await safeCache(root, false)) await fs.rename(temporary, cachePath(root));
    } catch {
      /* Optional cache failures do not fail current in-memory results. */
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
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
  const root = await fs.realpath(path.resolve(request.path ?? "."));
  const budget = request.budget ?? 12;
  const tokenBudget = request.tokenBudget ?? 4000;
  if (
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > 50 ||
    !Number.isInteger(tokenBudget) ||
    tokenBudget < 256 ||
    tokenBudget > 32000
  )
    throw new Error("Invalid repository context budget");
  const graph = await loadGraph(root, request.refresh ?? false);
  const terms = queryTerms(request.query);
  const changedFiles = new Set(request.changedFiles ?? []);

  const ranked = graph.files
    .map((file) => scoreFile(file, terms, request.mode, changedFiles))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const items: RankedContextItem[] = [];
  let estimatedTokens = 2; // Array delimiters. One UTF8 byte/token is a conservative estimate.
  for (const item of ranked) {
    const cost = Buffer.byteLength(JSON.stringify(item), "utf8") + (items.length ? 1 : 0);
    if (items.length >= budget) break;
    if (estimatedTokens + cost > tokenBudget) continue;
    items.push(item);
    estimatedTokens += cost;
  }

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
    tokenBudget,
    estimatedTokens,
    tokenEstimate: "utf8-byte-upper-bound",
    omittedItems: ranked.length - items.length,
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
    budget: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(12)
      .describe("Maximum files to return"),
    tokenBudget: z
      .number()
      .int()
      .min(256)
      .max(32000)
      .optional()
      .default(4000)
      .describe(
        "Conservative estimated token budget for ranked items, using UTF8 bytes; excludes wrapper metadata",
      ),
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
