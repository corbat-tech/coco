/**
 * Tests for web fetch tool
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

describe("web-fetch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("validateUrl", () => {
    it("should accept valid http/https URLs", async () => {
      const { validateUrl } = await import("./web-fetch.js");

      expect(() => validateUrl("https://example.com")).not.toThrow();
      expect(() => validateUrl("http://example.com")).not.toThrow();
    });

    it("should block file:// URLs", async () => {
      const { validateUrl } = await import("./web-fetch.js");

      expect(() => validateUrl("file:///etc/passwd")).toThrow("not allowed");
    });

    it("should block javascript: URLs", async () => {
      const { validateUrl } = await import("./web-fetch.js");

      expect(() => validateUrl("javascript:alert(1)")).toThrow("not allowed");
    });

    it("should block private IP addresses", async () => {
      const { validateUrl } = await import("./web-fetch.js");

      expect(() => validateUrl("http://127.0.0.1")).toThrow("private");
      expect(() => validateUrl("http://10.0.0.1")).toThrow("private");
      expect(() => validateUrl("http://192.168.1.1")).toThrow("private");
      expect(() => validateUrl("http://172.16.0.1")).toThrow("private");
      expect(() => validateUrl("http://localhost")).toThrow("private");
    });

    it("should reject non-http schemes", async () => {
      const { validateUrl } = await import("./web-fetch.js");

      expect(() => validateUrl("ftp://files.com/data")).toThrow("not allowed");
      expect(() => validateUrl("data:text/html,hello")).toThrow("not allowed");
    });
  });

  describe("extractMetadata", () => {
    it("should extract title", async () => {
      const { extractMetadata } = await import("./web-fetch.js");

      const html = "<html><head><title>Test Page</title></head></html>";
      const meta = extractMetadata(html);
      expect(meta.title).toBe("Test Page");
    });

    it("should extract meta description", async () => {
      const { extractMetadata } = await import("./web-fetch.js");

      const html =
        '<html><head><meta name="description" content="A test description"></head></html>';
      const meta = extractMetadata(html);
      expect(meta.description).toBe("A test description");
    });

    it("should extract author", async () => {
      const { extractMetadata } = await import("./web-fetch.js");

      const html =
        '<html><head><meta name="author" content="John Doe"></head></html>';
      const meta = extractMetadata(html);
      expect(meta.author).toBe("John Doe");
    });

    it("should handle missing metadata gracefully", async () => {
      const { extractMetadata } = await import("./web-fetch.js");

      const html = "<html><head></head></html>";
      const meta = extractMetadata(html);
      expect(meta.title).toBe("");
      expect(meta.description).toBeUndefined();
      expect(meta.author).toBeUndefined();
    });
  });

  describe("htmlToMarkdown", () => {
    it("should convert headings", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
      expect(htmlToMarkdown("<h2>Subtitle</h2>")).toContain("## Subtitle");
      expect(htmlToMarkdown("<h3>Section</h3>")).toContain("### Section");
    });

    it("should convert links", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown('<a href="https://example.com">Click here</a>');
      expect(md).toContain("[Click here](https://example.com)");
    });

    it("should convert code blocks", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
      expect(md).toContain("```");
      expect(md).toContain("const x = 1;");
    });

    it("should convert inline code", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("Use <code>npm install</code> to install");
      expect(md).toContain("`npm install`");
    });

    it("should convert unordered lists", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>");
      expect(md).toContain("- Item 1");
      expect(md).toContain("- Item 2");
    });

    it("should convert ordered lists", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>");
      expect(md).toContain("1. First");
      expect(md).toContain("2. Second");
    });

    it("should convert bold and italic", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      expect(htmlToMarkdown("<strong>bold</strong>")).toContain("**bold**");
      expect(htmlToMarkdown("<em>italic</em>")).toContain("*italic*");
    });

    it("should convert paragraphs", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<p>First paragraph</p><p>Second paragraph</p>");
      expect(md).toContain("First paragraph");
      expect(md).toContain("Second paragraph");
    });

    it("should decode HTML entities", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<p>&amp; &lt; &gt; &quot;</p>");
      expect(md).toContain("& < > \"");
    });

    it("should strip remaining HTML tags", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const md = htmlToMarkdown("<div><span>Content</span></div>");
      expect(md).not.toContain("<");
      expect(md).not.toContain(">");
      expect(md).toContain("Content");
    });

    it("should convert tables", async () => {
      const { htmlToMarkdown } = await import("./web-fetch.js");

      const html = `<table>
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>John</td><td>30</td></tr>
      </table>`;
      const md = htmlToMarkdown(html);
      expect(md).toContain("| Name | Age |");
      expect(md).toContain("| --- | --- |");
      expect(md).toContain("| John | 30 |");
    });
  });

  describe("webFetchTool", () => {
    it("should have correct metadata", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      expect(webFetchTool.name).toBe("web_fetch");
      expect(webFetchTool.category).toBe("web");
    });

    it("should validate parameters", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      const valid = webFetchTool.parameters.safeParse({
        url: "https://example.com",
      });
      expect(valid.success).toBe(true);

      const invalid = webFetchTool.parameters.safeParse({ url: "not-a-url" });
      expect(invalid.success).toBe(false);
    });

    it("should fetch and convert HTML to markdown", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      const mockHtml = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <article>
              <h1>Hello World</h1>
              <p>This is a test paragraph with enough content to be considered main content.
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua.</p>
            </article>
          </body>
        </html>
      `;

      const encoder = new TextEncoder();
      const encoded = encoder.encode(mockHtml);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: () => {
                if (done) return Promise.resolve({ done: true, value: undefined });
                done = true;
                return Promise.resolve({ done: false, value: encoded });
              },
              cancel: vi.fn(),
            };
          },
        },
      });

      const result = await webFetchTool.execute({
        url: "https://example.com/article",
        extractContent: true,
        maxLength: 50000,
        timeout: 30000,
      });

      expect(result.title).toBe("Test Page");
      expect(result.content).toContain("Hello World");
      expect(result.content).toContain("test paragraph");
      expect(result.url).toBe("https://example.com/article");
      expect(result.contentType).toContain("text/html");
      expect(result.duration).toBeGreaterThan(0);
    });

    it("should handle JSON content", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      const jsonData = JSON.stringify({ key: "value", number: 42 });
      const encoder = new TextEncoder();
      const encoded = encoder.encode(jsonData);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: () => {
                if (done) return Promise.resolve({ done: true, value: undefined });
                done = true;
                return Promise.resolve({ done: false, value: encoded });
              },
              cancel: vi.fn(),
            };
          },
        },
      });

      const result = await webFetchTool.execute({
        url: "https://api.example.com/data",
        extractContent: true,
        maxLength: 50000,
        timeout: 30000,
      });

      expect(result.content).toContain('"key": "value"');
    });

    it("should reject blocked URLs", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      await expect(
        webFetchTool.execute({
          url: "http://127.0.0.1/admin",
          extractContent: true,
          maxLength: 50000,
          timeout: 30000,
        }),
      ).rejects.toThrow("private");
    });

    it("should truncate long content", async () => {
      const { webFetchTool } = await import("./web-fetch.js");

      const longContent = "<html><body><p>" + "A".repeat(10000) + "</p></body></html>";
      const encoder = new TextEncoder();
      const encoded = encoder.encode(longContent);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html" }),
        body: {
          getReader: () => {
            let done = false;
            return {
              read: () => {
                if (done) return Promise.resolve({ done: true, value: undefined });
                done = true;
                return Promise.resolve({ done: false, value: encoded });
              },
              cancel: vi.fn(),
            };
          },
        },
      });

      const result = await webFetchTool.execute({
        url: "https://example.com/long",
        extractContent: true,
        maxLength: 1000,
        timeout: 30000,
      });

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(1000);
    });
  });
});
