/**
 * Tests for image understanding tool
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

describe("image", () => {
  describe("readImageTool", () => {
    it("should have correct metadata", async () => {
      const { readImageTool } = await import("./image.js");
      expect(readImageTool.name).toBe("read_image");
      expect(readImageTool.category).toBe("document");
    });

    it("should validate parameters", async () => {
      const { readImageTool } = await import("./image.js");

      const valid = readImageTool.parameters.safeParse({
        path: "screenshot.png",
      });
      expect(valid.success).toBe(true);

      const withPrompt = readImageTool.parameters.safeParse({
        path: "design.jpg",
        prompt: "What colors are used?",
        provider: "anthropic",
      });
      expect(withPrompt.success).toBe(true);

      const invalid = readImageTool.parameters.safeParse({
        path: "",
      });
      expect(invalid.success).toBe(false);
    });

    it("should throw for non-existent file", async () => {
      const { readImageTool } = await import("./image.js");

      await expect(
        readImageTool.execute({
          path: "/nonexistent/image.png",
          prompt: "describe",
        }),
      ).rejects.toThrow("not found");
    });

    it("should throw for unsupported format", async () => {
      const { readImageTool } = await import("./image.js");
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");

      // Create a temp file with unsupported extension
      const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.tiff`);
      await fs.writeFile(tmpFile, "fake image data");

      try {
        await expect(
          readImageTool.execute({
            path: tmpFile,
            prompt: "describe",
          }),
        ).rejects.toThrow("Unsupported image format");
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    });
  });
});
