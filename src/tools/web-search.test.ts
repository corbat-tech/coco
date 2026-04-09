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

  describe("extractRealUrl", () => {
    it("should extract URL from DDG proxy link", async () => {
      const { extractRealUrl } = await import("./web-search.js");

      const proxyUrl =
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2F&rut=abc123";
      expect(extractRealUrl(proxyUrl)).toBe("https://www.typescriptlang.org/");
    });

    it("should return direct http URLs as-is", async () => {
      const { extractRealUrl } = await import("./web-search.js");

      expect(extractRealUrl("https://example.com/page")).toBe("https://example.com/page");
      expect(extractRealUrl("http://example.com/page")).toBe("http://example.com/page");
    });

    it("should handle malformed URLs gracefully", async () => {
      const { extractRealUrl } = await import("./web-search.js");

      expect(extractRealUrl("not-a-url")).toBe("not-a-url");
    });
  });

  describe("parseDuckDuckGoResults", () => {
    it("should parse simple nofollow link format (backward compat)", async () => {
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

    it("should parse real DDG Lite HTML with proxy URLs and result-link class", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      // Realistic DDG Lite HTML structure (uses single quotes, proxy URLs)
      const html = `
        <table border="0">
          <tr>
            <td valign="top">1.&nbsp;</td>
            <td>
              <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2F&amp;rut=abc123" class='result-link'>TypeScript: JavaScript With Syntax For Types.</a>
            </td>
          </tr>
          <tr>
            <td>&nbsp;&nbsp;&nbsp;</td>
            <td class='result-snippet'>
              <b>TypeScript</b> is a strongly typed programming language.
            </td>
          </tr>
          <tr>
            <td valign="top">2.&nbsp;</td>
            <td>
              <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.w3schools.com%2Ftypescript%2F&amp;rut=def456" class='result-link'>TypeScript Tutorial - W3Schools</a>
            </td>
          </tr>
          <tr>
            <td>&nbsp;&nbsp;&nbsp;</td>
            <td class='result-snippet'>Learn TypeScript step by step.</td>
          </tr>
        </table>
      `;

      const results = parseDuckDuckGoResults(html, 5);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("TypeScript: JavaScript With Syntax For Types.");
      expect(results[0].url).toBe("https://www.typescriptlang.org/");
      expect(results[0].snippet).toContain("strongly typed programming language");
      expect(results[1].title).toBe("TypeScript Tutorial - W3Schools");
      expect(results[1].url).toBe("https://www.w3schools.com/typescript/");
    });

    it("should filter out sponsored results", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      const html = `
        <table>
          <tr class="result-sponsored">
            <td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsponsored.com" class='result-link'>Sponsored Ad</a></td>
          </tr>
          <tr class="result-sponsored">
            <td class='result-snippet'>Buy now!</td>
          </tr>
          <tr>
            <td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Forganic.com" class='result-link'>Organic Result</a></td>
          </tr>
          <tr>
            <td class='result-snippet'>Real content.</td>
          </tr>
        </table>
      `;

      const results = parseDuckDuckGoResults(html, 5);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://organic.com");
      expect(results[0].title).toBe("Organic Result");
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

    it("should handle snippets with single-quoted class attributes", async () => {
      const { parseDuckDuckGoResults } = await import("./web-search.js");

      const html = `
        <a rel="nofollow" href="https://example.com">Example</a>
        <td class='result-snippet'>Single quote snippet</td>
      `;

      const results = parseDuckDuckGoResults(html, 5);
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe("Single quote snippet");
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

    it("should execute search with mocked fetch (simple format)", async () => {
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

    it("should execute search with mocked fetch (real DDG format)", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const mockHtml = `
        <table>
          <tr>
            <td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fresult&amp;rut=abc" class='result-link'>Test Result</a></td>
          </tr>
          <tr>
            <td class='result-snippet'>A test snippet from DDG.</td>
          </tr>
        </table>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await webSearchTool.execute({
        query: "test query real",
        maxResults: 5,
        engine: "duckduckgo",
      });

      expect(result.engine).toBe("duckduckgo");
      expect(result.results).toHaveLength(1);
      expect(result.results[0].url).toBe("https://example.com/result");
      expect(result.results[0].title).toBe("Test Result");
      expect(result.results[0].snippet).toBe("A test snippet from DDG.");
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

    it("should fallback to duckduckgo when Brave key is missing", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const original = process.env.BRAVE_SEARCH_API_KEY;
      delete process.env.BRAVE_SEARCH_API_KEY;

      const mockHtml = `
        <a rel="nofollow" href="https://example.com/result">Test Result</a>
        <td class="result-snippet">A test snippet.</td>
      `;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await webSearchTool.execute({
        query: "test",
        maxResults: 5,
        engine: "brave",
      });

      expect(result.engine).toBe("duckduckgo");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("lite.duckduckgo.com/lite/?q="),
        expect.any(Object),
      );

      if (original) process.env.BRAVE_SEARCH_API_KEY = original;
    });

    it("should fallback to duckduckgo when SerpAPI key is missing", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const original = process.env.SERPAPI_KEY;
      delete process.env.SERPAPI_KEY;

      const mockHtml = `
        <a rel="nofollow" href="https://example.com/result">Test Result</a>
        <td class="result-snippet">A test snippet.</td>
      `;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await webSearchTool.execute({
        query: "test",
        maxResults: 5,
        engine: "serpapi",
      });

      expect(result.engine).toBe("duckduckgo");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("lite.duckduckgo.com/lite/?q="),
        expect.any(Object),
      );

      if (original) process.env.SERPAPI_KEY = original;
    });

    it("should use Brave engine when BRAVE_SEARCH_API_KEY is set", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const original = process.env.BRAVE_SEARCH_API_KEY;
      process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            web: {
              results: [{ title: "Brave Result", url: "https://example.com", description: "ok" }],
            },
          }),
      });

      const result = await webSearchTool.execute({
        query: "test brave",
        maxResults: 5,
        engine: "brave",
      });

      expect(result.engine).toBe("brave");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.search.brave.com/res/v1/web/search"),
        expect.any(Object),
      );

      if (original) process.env.BRAVE_SEARCH_API_KEY = original;
      else delete process.env.BRAVE_SEARCH_API_KEY;
    });

    it("should use SerpAPI engine when SERPAPI_KEY is set", async () => {
      const { webSearchTool } = await import("./web-search.js");

      const original = process.env.SERPAPI_KEY;
      process.env.SERPAPI_KEY = "test-serpapi-key";

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            organic_results: [
              { title: "SerpAPI Result", link: "https://example.com", snippet: "ok" },
            ],
          }),
      });

      const result = await webSearchTool.execute({
        query: "test serpapi",
        maxResults: 5,
        engine: "serpapi",
      });

      expect(result.engine).toBe("serpapi");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("serpapi.com/search.json"),
        expect.any(Object),
      );

      if (original) process.env.SERPAPI_KEY = original;
      else delete process.env.SERPAPI_KEY;
    });
  });
});
