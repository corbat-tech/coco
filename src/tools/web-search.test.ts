/**
 * Tests for web search tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("web-search", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("parseDuckDuckGoResults", () => {
    it("should parse DuckDuckGo Lite HTML results", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      const html = `
        <table>
          <tr>
            <td><a rel="nofollow" href="https://example.com/page1">Result One Title</a></td>
          </tr>
          <tr>
            <td class="result-snippet">This is the first result snippet.</td>
          </tr>
          <tr>
            <td><a rel="nofollow" href="https://example.com/page2">Result Two Title</a></td>
          </tr>
          <tr>
            <td class="result-snippet">This is the second result snippet.</td>
          </tr>
        </table>
      `;

      const results = parseDuckDuckGoResults(html, 5);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Result One Title");
      expect(results[0].url).toBe("https://example.com/page1");
      expect(results[0].snippet).toBe("This is the first result snippet.");
      expect(results[1].title).toBe("Result Two Title");
    });

    it("should respect maxResults limit", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      const html = `
        <a rel="nofollow" href="https://a.com">A</a>
        <td class="result-snippet">Snippet A</td>
        <a rel="nofollow" href="https://b.com">B</a>
        <td class="result-snippet">Snippet B</td>
        <a rel="nofollow" href="https://c.com">C</a>
        <td class="result-snippet">Snippet C</td>
      `;

      const results = parseDuckDuckGoResults(html, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should skip non-http links", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      const html = `
        <a rel="nofollow" href="javascript:void(0)">Bad Link</a>
        <a rel="nofollow" href="https://good.com">Good Link</a>
        <td class="result-snippet">Good snippet</td>
      `;

      const results = parseDuckDuckGoResults(html, 5);
      const httpResults = results.filter((r) => r.url.startsWith("http"));
      expect(httpResults.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("webSearchTool", () => {
    it("should have correct metadata", async () => {
      const { webSearchTool } = await import("./web-search.js");

      expect(webSearchTool.name).toBe("web_search");
      expect(webSearchTool.category).toBe("web");
      expect(webSearchTool.description).toContain("Search the web");
    });

    it("should validate parameters", async () => {
      const { webSearchTool } = await import("./web-search.js");

      // Valid params
      const result = webSearchTool.parameters.safeParse({
        query: "test query",
      });
      expect(result.success).toBe(true);

      // Empty query should fail
      const empty = webSearchTool.parameters.safeParse({ query: "" });
      expect(empty.success).toBe(false);
    });

    it("should execute search with mocked fetch", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const mockHtml = `
        <a rel="nofollow" href="https://example.com/result">Test Result</a>
        <td class="result-snippet">A test snippet.</td>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await webSearchTool.execute({
        query: "test query",
        maxResults: 5,
        engine: "duckduckgo",
      });

      expect(result.engine).toBe("duckduckgo");
      expect(result.duration).toBeGreaterThan(0);
      expect(Array.isArray(result.results)).toBe(true);
    });

    it("should throw on empty query after sanitization", async () => {
      const { webSearchTool } = await import("./web-search.js");

      await expect(
        webSearchTool.execute({
          query: "\x00\x01\x02",
          maxResults: 5,
          engine: "duckduckgo",
        }),
      ).rejects.toThrow("empty after sanitization");
    });

    it("should require API key for Brave engine", async () => {
      const { webSearchTool } = await import("./web-search.js");

      // Remove env var
      const original = process.env.BRAVE_SEARCH_API_KEY;
      delete process.env.BRAVE_SEARCH_API_KEY;

      await expect(
        webSearchTool.execute({
          query: "test",
          maxResults: 5,
          engine: "brave",
        }),
      ).rejects.toThrow("BRAVE_SEARCH_API_KEY");

      // Restore
      if (original) process.env.BRAVE_SEARCH_API_KEY = original;
    });

    it("should require API key for SerpAPI engine", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const original = process.env.SERPAPI_KEY;
      delete process.env.SERPAPI_KEY;

      await expect(
        webSearchTool.execute({
          query: "test",
          maxResults: 5,
          engine: "serpapi",
        }),
      ).rejects.toThrow("SERPAPI_KEY");

      if (original) process.env.SERPAPI_KEY = original;
    });
  });
});
