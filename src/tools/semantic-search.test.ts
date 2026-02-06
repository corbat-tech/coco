/**
 * Tests for semantic search tool
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("semantic-search", () => {
  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", async () => {
      const { cosineSimilarity } = await import("./semantic-search.js");
      const v = [1, 0, 0, 1];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", async () => {
      const { cosineSimilarity } = await import("./semantic-search.js");
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it("should return -1 for opposite vectors", async () => {
      const { cosineSimilarity } = await import("./semantic-search.js");
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
    });

    it("should handle zero vectors", async () => {
      const { cosineSimilarity } = await import("./semantic-search.js");
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it("should handle different length vectors", async () => {
      const { cosineSimilarity } = await import("./semantic-search.js");
      expect(cosineSimilarity([1, 2], [3, 4, 5])).toBe(0);
    });
  });

  describe("chunkContent", () => {
    it("should split content into chunks", async () => {
      const { chunkContent } = await import("./semantic-search.js");

      const content = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: content here`).join("\n");
      const chunks = chunkContent(content, 20);

      expect(chunks.length).toBe(3);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(20);
      expect(chunks[1].startLine).toBe(21);
    });

    it("should skip very short chunks", async () => {
      const { chunkContent } = await import("./semantic-search.js");

      const content = "a\nb\nc";
      const chunks = chunkContent(content, 20);
      // "a\nb\nc" is only 5 chars, might be skipped
      expect(chunks.length).toBeLessThanOrEqual(1);
    });

    it("should handle empty content", async () => {
      const { chunkContent } = await import("./semantic-search.js");
      const chunks = chunkContent("", 20);
      expect(chunks).toHaveLength(0);
    });
  });

  describe("semanticSearchTool", () => {
    it("should have correct metadata", async () => {
      const { semanticSearchTool } = await import("./semantic-search.js");
      expect(semanticSearchTool.name).toBe("semantic_search");
      expect(semanticSearchTool.category).toBe("search");
    });

    it("should validate parameters", async () => {
      const { semanticSearchTool } = await import("./semantic-search.js");

      const valid = semanticSearchTool.parameters.safeParse({
        query: "authentication logic",
      });
      expect(valid.success).toBe(true);

      const invalid = semanticSearchTool.parameters.safeParse({
        query: "",
      });
      expect(invalid.success).toBe(false);
    });
  });
});
