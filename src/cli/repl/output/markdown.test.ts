/**
 * Tests for markdown terminal rendering
 */

import { describe, it, expect } from "vitest";
import {
  renderMarkdown,
  renderAssistantMarkdown,
  renderInlineMarkdown,
  containsMarkdown,
} from "./markdown.js";

describe("markdown rendering", () => {
  describe("containsMarkdown", () => {
    it("should detect headers", () => {
      expect(containsMarkdown("# Hello")).toBe(true);
      expect(containsMarkdown("## World")).toBe(true);
      expect(containsMarkdown("### Test")).toBe(true);
    });

    it("should detect bold text", () => {
      expect(containsMarkdown("This is **bold**")).toBe(true);
    });

    it("should detect italic text", () => {
      expect(containsMarkdown("This is *italic*")).toBe(true);
    });

    it("should detect inline code", () => {
      expect(containsMarkdown("Use `console.log`")).toBe(true);
    });

    it("should detect code blocks", () => {
      expect(containsMarkdown("```js\ncode\n```")).toBe(true);
    });

    it("should detect lists", () => {
      expect(containsMarkdown("- item 1\n- item 2")).toBe(true);
      expect(containsMarkdown("1. first\n2. second")).toBe(true);
    });

    it("should detect links", () => {
      expect(containsMarkdown("[text](url)")).toBe(true);
    });

    it("should detect blockquotes", () => {
      expect(containsMarkdown("> quoted text")).toBe(true);
    });

    it("should return false for plain text", () => {
      expect(containsMarkdown("Hello world")).toBe(false);
      expect(containsMarkdown("Just some text")).toBe(false);
    });
  });

  describe("renderMarkdown", () => {
    it("should render without throwing", () => {
      expect(() => renderMarkdown("# Hello")).not.toThrow();
    });

    it("should return a string", () => {
      const result = renderMarkdown("**bold**");
      expect(typeof result).toBe("string");
    });

    it("should handle empty input", () => {
      expect(renderMarkdown("")).toBe("");
    });

    it("should handle plain text", () => {
      const result = renderMarkdown("Hello world");
      expect(result).toContain("Hello world");
    });
  });

  describe("renderAssistantMarkdown", () => {
    it("should add indentation", () => {
      const result = renderAssistantMarkdown("Hello");
      // Should have some indentation
      expect(result).toMatch(/^\s{2}/);
    });

    it("should preserve content", () => {
      const result = renderAssistantMarkdown("Test content");
      expect(result).toContain("Test content");
    });
  });

  describe("renderInlineMarkdown", () => {
    it("should handle bold text", () => {
      const result = renderInlineMarkdown("This is **bold** text");
      // Should contain the word "bold" (might have ANSI codes)
      expect(result).toContain("bold");
    });

    it("should handle inline code", () => {
      const result = renderInlineMarkdown("Use `code` here");
      expect(result).toContain("code");
    });

    it("should handle links", () => {
      const result = renderInlineMarkdown("Check [this](http://example.com)");
      expect(result).toContain("this");
      expect(result).toContain("example.com");
    });

    it("should return plain text unchanged", () => {
      const result = renderInlineMarkdown("Plain text");
      expect(result).toContain("Plain text");
    });
  });
});
