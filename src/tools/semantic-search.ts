/**
 * Semantic Search tool for Corbat-Coco
 * Vector-based code search using local embeddings
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");
const { glob } = await import("glob");

/**
 * Default index directory
 */
const INDEX_DIR = ".coco/search-index";

/**
 * Default chunk size (lines per chunk)
 */
const DEFAULT_CHUNK_SIZE = 20;

/**
 * Binary file extensions to skip
 */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
  ".pdf", ".doc", ".docx",
  ".mp3", ".mp4", ".avi", ".mov",
  ".wasm", ".bin",
]);

/**
 * Default exclude patterns
 */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/*.min.*",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

/**
 * Chunk entry for index
 */
interface IndexChunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
  mtime: number;
}

/**
 * Search index
 */
interface SearchIndex {
  version: number;
  model: string;
  chunks: IndexChunk[];
  lastUpdated: string;
}

/**
 * Semantic search result item
 */
export interface SemanticSearchResultItem {
  file: string;
  line: number;
  snippet: string;
  score: number;
  context: string;
}

/**
 * Semantic search output
 */
export interface SemanticSearchOutput {
  results: SemanticSearchResultItem[];
  totalIndexed: number;
  indexAge: string;
  duration: number;
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Split file content into chunks
 */
export function chunkContent(
  content: string,
  chunkSize: number,
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = content.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunkLines = lines.slice(i, Math.min(i + chunkSize, lines.length));
    const text = chunkLines.join("\n").trim();
    if (text.length > 10) {
      // Skip very short chunks
      chunks.push({
        text,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
      });
    }
  }

  return chunks;
}

/**
 * Simple TF-IDF based embedding fallback
 * Used when @xenova/transformers is not available
 */
function simpleEmbedding(text: string): number[] {
  // Tokenize
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  // Build frequency map
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Create a deterministic hash-based vector (128 dimensions)
  const dimensions = 128;
  const vector = new Array<number>(dimensions).fill(0);

  for (const [word, count] of freq) {
    // Simple hash to distribute word into dimensions
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) & 0x7fffffff;
    }

    const idx = hash % dimensions;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[idx] = (vector[idx] ?? 0) + sign * count * (1 / Math.sqrt(words.length));
  }

  // Normalize
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }
  }

  return vector;
}

/**
 * Generate embedding for text
 * Tries @xenova/transformers first, falls back to simple TF-IDF
 */
let embedFn: ((text: string) => Promise<number[]>) | null = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!embedFn) {
    try {
      // Try to use @xenova/transformers (optional dependency)
      const transformers = await import("@xenova/transformers");
      const pipeline = await transformers.pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );

      embedFn = async (t: string) => {
        const output = await pipeline(t, {
          pooling: "mean",
          normalize: true,
        });
        return Array.from(output.data);
      };
    } catch {
      // Fall back to simple embedding
      embedFn = async (t: string) => simpleEmbedding(t);
    }
  }

  return embedFn(text);
}

/**
 * Load search index
 */
async function loadIndex(indexDir: string): Promise<SearchIndex | null> {
  try {
    const indexPath = path.join(indexDir, "index.json");
    const content = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(content) as SearchIndex;
  } catch {
    return null;
  }
}

/**
 * Save search index
 */
async function saveIndex(
  indexDir: string,
  index: SearchIndex,
): Promise<void> {
  await fs.mkdir(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index), "utf-8");
}

/**
 * Check if file is binary
 */
function isBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Semantic search tool
 */
export const semanticSearchTool: ToolDefinition<
  {
    query: string;
    path?: string;
    include?: string;
    maxResults?: number;
    threshold?: number;
    reindex?: boolean;
  },
  SemanticSearchOutput
> = defineTool({
  name: "semantic_search",
  description: `Search codebase by meaning using vector embeddings, not just regex.
Good for finding conceptually related code, e.g., "where is authentication handled?".

Examples:
- Conceptual search: { "query": "error handling and retry logic" }
- In specific dir: { "query": "database connection", "path": "src/db" }
- Force reindex: { "query": "user permissions", "reindex": true }`,
  category: "search",
  parameters: z.object({
    query: z.string().min(1).describe("Natural language search query"),
    path: z
      .string()
      .optional()
      .default(".")
      .describe("Root directory to search"),
    include: z
      .string()
      .optional()
      .describe("Glob pattern for files to include (e.g., '**/*.ts')"),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum results"),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.3)
      .describe("Minimum similarity score (0-1)"),
    reindex: z
      .boolean()
      .optional()
      .default(false)
      .describe("Force rebuild of search index"),
  }),
  async execute({
    query,
    path: rootPath,
    include,
    maxResults,
    threshold,
    reindex,
  }) {
    const startTime = performance.now();
    const effectivePath = rootPath ?? ".";
    const effectiveMaxResults = maxResults ?? 10;
    const effectiveThreshold = threshold ?? 0.3;
    const absPath = path.resolve(effectivePath);
    const indexDir = path.join(absPath, INDEX_DIR);

    // Load or build index
    let index = reindex ? null : await loadIndex(indexDir);

    if (!index) {
      // Build index
      const pattern = include ?? "**/*";
      const files = await glob(pattern, {
        cwd: absPath,
        ignore: DEFAULT_EXCLUDES,
        nodir: true,
        absolute: false,
      });

      const chunks: IndexChunk[] = [];

      for (const file of files) {
        if (isBinary(file)) continue;

        const fullPath = path.join(absPath, file);
        try {
          const stat = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath, "utf-8");

          // Skip very large files (>100KB)
          if (content.length > 100000) continue;

          const fileChunks = chunkContent(content, DEFAULT_CHUNK_SIZE);

          for (const chunk of fileChunks) {
            const vector = await getEmbedding(chunk.text);
            chunks.push({
              file,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              text: chunk.text,
              vector,
              mtime: stat.mtimeMs,
            });
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      index = {
        version: 1,
        model: "simple-tfidf",
        chunks,
        lastUpdated: new Date().toISOString(),
      };

      // Save index for future use
      try {
        await saveIndex(indexDir, index);
      } catch {
        // Non-fatal: index not saved
      }
    }

    // Generate query embedding
    const queryVector = await getEmbedding(query);

    // Search
    const scored = index.chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryVector, chunk.vector),
    }));

    // Filter and sort
    const filtered = scored
      .filter((s) => s.score >= effectiveThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveMaxResults);

    // Build results
    const results: SemanticSearchResultItem[] = filtered.map((s) => {
      const lines = s.chunk.text.split("\n");
      const snippet =
        lines.length > 5 ? lines.slice(0, 5).join("\n") + "\n..." : s.chunk.text;

      return {
        file: s.chunk.file,
        line: s.chunk.startLine,
        snippet,
        score: Math.round(s.score * 1000) / 1000,
        context: s.chunk.text,
      };
    });

    // Calculate index age
    const indexDate = new Date(index.lastUpdated);
    const ageMs = Date.now() - indexDate.getTime();
    const ageMinutes = Math.round(ageMs / 60000);
    const indexAge =
      ageMinutes < 60
        ? `${ageMinutes}m ago`
        : `${Math.round(ageMinutes / 60)}h ago`;

    return {
      results,
      totalIndexed: index.chunks.length,
      indexAge,
      duration: performance.now() - startTime,
    };
  },
});

/**
 * All semantic search tools
 */
export const semanticSearchTools = [semanticSearchTool];
