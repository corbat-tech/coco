/**
 * Tests for clipboard utility
 */

import { describe, it, expect } from "vitest";

describe("clipboard", () => {
  describe("isClipboardAvailable", () => {
    it("should export isClipboardAvailable function", async () => {
      const { isClipboardAvailable } = await import("./clipboard.js");
      expect(typeof isClipboardAvailable).toBe("function");
    });

    it("should return a boolean", async () => {
      const { isClipboardAvailable } = await import("./clipboard.js");
      const result = await isClipboardAvailable();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("copyToClipboard", () => {
    it("should export copyToClipboard function", async () => {
      const { copyToClipboard } = await import("./clipboard.js");
      expect(typeof copyToClipboard).toBe("function");
    });
  });
});
