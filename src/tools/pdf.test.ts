/**
 * Tests for PDF reader tool
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

describe("pdf", () => {
  describe("parsePageRange", () => {
    it("should parse single page", async () => {
      const { parsePageRange } = await import("./pdf.js");
      expect(parsePageRange("3", 10)).toEqual({ start: 3, end: 3 });
    });

    it("should parse page range", async () => {
      const { parsePageRange } = await import("./pdf.js");
      expect(parsePageRange("2-5", 10)).toEqual({ start: 2, end: 5 });
    });

    it("should clamp to total pages", async () => {
      const { parsePageRange } = await import("./pdf.js");
      expect(parsePageRange("1-100", 10)).toEqual({ start: 1, end: 10 });
    });

    it("should handle invalid range", async () => {
      const { parsePageRange } = await import("./pdf.js");
      const result = parsePageRange("abc", 10);
      expect(result.start).toBe(1);
    });
  });

  describe("readPdfTool", () => {
    it("should have correct metadata", async () => {
      const { readPdfTool } = await import("./pdf.js");
      expect(readPdfTool.name).toBe("read_pdf");
      expect(readPdfTool.category).toBe("document");
    });

    it("should validate parameters", async () => {
      const { readPdfTool } = await import("./pdf.js");

      const valid = readPdfTool.parameters.safeParse({
        path: "file.pdf",
      });
      expect(valid.success).toBe(true);

      const withPages = readPdfTool.parameters.safeParse({
        path: "file.pdf",
        pages: "1-5",
      });
      expect(withPages.success).toBe(true);

      const invalid = readPdfTool.parameters.safeParse({
        path: "",
      });
      expect(invalid.success).toBe(false);
    });

    it("should throw for non-existent file", async () => {
      const { readPdfTool } = await import("./pdf.js");

      await expect(
        readPdfTool.execute({
          path: "/nonexistent/file.pdf",
          maxPages: 20,
        }),
      ).rejects.toThrow("not found");
    });

    it("should throw for non-PDF file", async () => {
      const { readPdfTool } = await import("./pdf.js");
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");

      // Create a temp file with non-pdf extension
      const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
      await fs.writeFile(tmpFile, "not a pdf");

      try {
        await expect(
          readPdfTool.execute({
            path: tmpFile,
            maxPages: 20,
          }),
        ).rejects.toThrow("PDF");
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    });
  });
});
