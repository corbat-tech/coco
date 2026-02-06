/**
 * Web Search tool for Corbat-Coco
 * Search the web for documentation, error solutions, and API references
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError, TimeoutError } from "../utils/errors.js";

/**
 * Default search timeout (15 seconds)
 */
const DEFAULT_SEARCH_TIMEOUT_MS = 15000;

/**
 * Maximum query length
 */
const MAX_QUERY_LENGTH = 500;

/**
 * Minimum delay between requests (rate limiting)
 */
const MIN_REQUEST_INTERVAL_MS = 1000;

/**
 * Last request timestamp for rate limiting
 */
let lastRequestTime = 0;

/**
 * Search result interface
 */
export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  results: WebSearchResultItem[];
  totalResults: number;
  engine: string;
  duration: number;
}

/**
 * Sanitize search query
 */
function sanitizeQuery(query: string): string {
  // Strip control characters
  const cleaned = query.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  // Limit length
  return cleaned.slice(0, MAX_QUERY_LENGTH);
}

/**
 * Rate limit: wait if needed
 */
async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
    );
  }
  lastRequestTime = Date.now();
}

/**
 * Parse DuckDuckGo Lite HTML results
 */
export function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];

  // DuckDuckGo Lite uses a table-based layout
  // Each result has a link in a <a class="result-link"> or similar pattern
  // We parse using regex since we don't want a DOM dependency here
  const resultPattern =
    /<a\s+[^>]*rel="nofollow"\s+[^>]*href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/gi;
  const snippetPattern =
    /<td\s+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  // Extract URLs and titles
  const links: Array<{ url: string; title: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = resultPattern.exec(html)) !== null) {
    const url = (match[1] ?? "").trim();
    const title = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
    if (url.startsWith("http") && title.length > 0) {
      links.push({ url, title });
    }
  }

  // Extract snippets
  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null) {
    const snippet = (match[1] ?? "").replace(/<[^>]*>/g, "").trim();
    if (snippet.length > 0) {
      snippets.push(snippet);
    }
  }

  // Combine links and snippets
  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    const link = links[i];
    if (!link) continue;
    results.push({
      title: link.title,
      url: link.url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

/**
 * Search using DuckDuckGo Lite
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number,
  timeout: number,
): Promise<WebSearchResultItem[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Corbat-Coco/0.3.0",
        Accept: "text/html",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ToolError(
        `DuckDuckGo search failed with status ${response.status}`,
        { tool: "web_search" },
      );
    }

    const html = await response.text();
    return parseDuckDuckGoResults(html, maxResults);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Search using Brave Search API
 */
async function searchBrave(
  query: string,
  maxResults: number,
  timeout: number,
): Promise<WebSearchResultItem[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new ToolError(
      "BRAVE_SEARCH_API_KEY environment variable is required for Brave search",
      { tool: "web_search" },
    );
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Corbat-Coco/0.3.0",
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ToolError(
        `Brave search failed with status ${response.status}`,
        { tool: "web_search" },
      );
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };

    return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Search using SerpAPI
 */
async function searchSerpApi(
  query: string,
  maxResults: number,
  timeout: number,
): Promise<WebSearchResultItem[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    throw new ToolError(
      "SERPAPI_KEY environment variable is required for SerpAPI search",
      { tool: "web_search" },
    );
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://serpapi.com/search.json?q=${encodedQuery}&num=${maxResults}&api_key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Corbat-Coco/0.3.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ToolError(
        `SerpAPI search failed with status ${response.status}`,
        { tool: "web_search" },
      );
    }

    const data = (await response.json()) as {
      organic_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
      }>;
    };

    return (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
    }));
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Web search tool
 */
export const webSearchTool: ToolDefinition<
  {
    query: string;
    maxResults?: number;
    engine?: "duckduckgo" | "brave" | "serpapi";
  },
  WebSearchOutput
> = defineTool({
  name: "web_search",
  description: `Search the web for information, documentation, error solutions, and API references.

Examples:
- Basic search: { "query": "typescript zod validation examples" }
- Limited results: { "query": "react hooks best practices", "maxResults": 3 }
- Specific engine: { "query": "node.js stream API", "engine": "brave" }`,
  category: "web",
  parameters: z.object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("Search query"),
    maxResults: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe("Maximum number of results to return"),
    engine: z
      .enum(["duckduckgo", "brave", "serpapi"])
      .optional()
      .default("duckduckgo")
      .describe("Search engine to use"),
  }),
  async execute({ query, maxResults = 5, engine = "duckduckgo" }) {
    const startTime = performance.now();
    const sanitizedQuery = sanitizeQuery(query);

    if (sanitizedQuery.length === 0) {
      throw new ToolError("Search query is empty after sanitization", {
        tool: "web_search",
      });
    }

    // Rate limiting
    await enforceRateLimit();

    try {
      let results: WebSearchResultItem[];

      switch (engine) {
        case "brave":
          results = await searchBrave(
            sanitizedQuery,
            maxResults,
            DEFAULT_SEARCH_TIMEOUT_MS,
          );
          break;
        case "serpapi":
          results = await searchSerpApi(
            sanitizedQuery,
            maxResults,
            DEFAULT_SEARCH_TIMEOUT_MS,
          );
          break;
        case "duckduckgo":
        default:
          results = await searchDuckDuckGo(
            sanitizedQuery,
            maxResults,
            DEFAULT_SEARCH_TIMEOUT_MS,
          );
          break;
      }

      return {
        results,
        totalResults: results.length,
        engine: engine ?? "duckduckgo",
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ToolError || error instanceof TimeoutError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new TimeoutError(
          `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS}ms`,
          {
            timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,
            operation: `web_search: ${sanitizedQuery}`,
          },
        );
      }

      throw new ToolError(
        `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "web_search", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});
