/**
 * Tests for string utilities
 */

import { describe, it, expect } from "vitest";
import {
  truncate,
  slugify,
  capitalize,
  camelToKebab,
  kebabToCamel,
  indent,
  dedent,
  pluralize,
  wrapText,
  formatBytes,
  formatDuration,
  extractCodeBlocks,
  escapeRegex,
  escapeHtml,
  stripAnsi,
  padString,
  randomString,
} from "./strings.js";

describe("truncate", () => {
  it("should not truncate short strings", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should truncate long strings", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("should use custom suffix", () => {
    expect(truncate("hello world", 8, "…")).toBe("hello w…");
  });
});

describe("slugify", () => {
  it("should convert to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should replace spaces with hyphens", () => {
    expect(slugify("hello world")).toBe("hello-world");
  });

  it("should remove special characters", () => {
    expect(slugify("Hello! World?")).toBe("hello-world");
  });

  it("should handle underscores", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });
});

describe("capitalize", () => {
  it("should capitalize first letter", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  it("should handle empty string", () => {
    expect(capitalize("")).toBe("");
  });

  it("should not change rest of string", () => {
    expect(capitalize("hELLO")).toBe("HELLO");
  });
});

describe("camelToKebab", () => {
  it("should convert camelCase to kebab-case", () => {
    expect(camelToKebab("helloWorld")).toBe("hello-world");
  });

  it("should handle multiple capitals", () => {
    // Note: consecutive capitals are treated as one word, so HTTP becomes httpserver
    expect(camelToKebab("myHTTPServer")).toBe("my-httpserver");
  });
});

describe("kebabToCamel", () => {
  it("should convert kebab-case to camelCase", () => {
    expect(kebabToCamel("hello-world")).toBe("helloWorld");
  });

  it("should handle multiple hyphens", () => {
    expect(kebabToCamel("my-http-server")).toBe("myHttpServer");
  });
});

describe("indent", () => {
  it("should indent single line", () => {
    expect(indent("hello", 2)).toBe("  hello");
  });

  it("should indent multiple lines", () => {
    expect(indent("hello\nworld", 2)).toBe("  hello\n  world");
  });

  it("should use custom indent size", () => {
    expect(indent("hello", 4)).toBe("    hello");
  });
});

describe("dedent", () => {
  it("should remove common indentation", () => {
    const input = "  hello\n  world";
    expect(dedent(input)).toBe("hello\nworld");
  });

  it("should handle mixed indentation", () => {
    const input = "    hello\n  world";
    expect(dedent(input)).toBe("  hello\nworld");
  });

  it("should ignore empty lines", () => {
    const input = "  hello\n\n  world";
    expect(dedent(input)).toBe("hello\n\nworld");
  });

  it("should return unchanged if no indentation", () => {
    const input = "hello\nworld";
    expect(dedent(input)).toBe("hello\nworld");
  });

  it("should return unchanged if only empty lines", () => {
    const input = "\n\n\n";
    expect(dedent(input)).toBe("\n\n\n");
  });
});

describe("pluralize", () => {
  it("should return singular for count 1", () => {
    expect(pluralize("task", 1)).toBe("task");
  });

  it("should return plural for count != 1", () => {
    expect(pluralize("task", 0)).toBe("tasks");
    expect(pluralize("task", 2)).toBe("tasks");
    expect(pluralize("task", 10)).toBe("tasks");
  });

  it("should use custom plural", () => {
    expect(pluralize("child", 2, "children")).toBe("children");
  });
});

describe("wrapText", () => {
  it("should wrap long lines", () => {
    const text = "hello world this is a test";
    expect(wrapText(text, 12)).toBe("hello world\nthis is a\ntest");
  });

  it("should not wrap short text", () => {
    expect(wrapText("hello", 80)).toBe("hello");
  });
});

describe("formatBytes", () => {
  it("should format bytes", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
    expect(formatBytes(500)).toBe("500 Bytes");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1048576)).toBe("1 MB");
  });
});

describe("formatDuration", () => {
  it("should format milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("should format seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("should format minutes", () => {
    expect(formatDuration(90000)).toBe("1m 30s");
  });

  it("should format hours", () => {
    expect(formatDuration(3661000)).toBe("1h 1m");
  });
});

describe("extractCodeBlocks", () => {
  it("should extract code blocks from markdown", () => {
    const markdown = `
Some text

\`\`\`typescript
const x = 1;
\`\`\`

More text

\`\`\`javascript
const y = 2;
\`\`\`
`;

    const blocks = extractCodeBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.language).toBe("typescript");
    expect(blocks[0]?.code).toContain("const x = 1");
    expect(blocks[1]?.language).toBe("javascript");
  });

  it("should handle blocks without language", () => {
    const markdown = "```\ncode\n```";
    const blocks = extractCodeBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.language).toBe("");
  });
});

describe("escapeRegex", () => {
  it("should escape special regex characters", () => {
    expect(escapeRegex("hello.world")).toBe("hello\\.world");
    expect(escapeRegex("test*")).toBe("test\\*");
    expect(escapeRegex("foo+bar")).toBe("foo\\+bar");
    expect(escapeRegex("a?b")).toBe("a\\?b");
  });

  it("should escape brackets and parentheses", () => {
    expect(escapeRegex("[test]")).toBe("\\[test\\]");
    expect(escapeRegex("(group)")).toBe("\\(group\\)");
    expect(escapeRegex("{curly}")).toBe("\\{curly\\}");
  });

  it("should escape pipe and caret", () => {
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("^start")).toBe("\\^start");
    expect(escapeRegex("end$")).toBe("end\\$");
  });

  it("should handle backslashes", () => {
    expect(escapeRegex("path\\to\\file")).toBe("path\\\\to\\\\file");
  });
});

describe("escapeHtml", () => {
  it("should escape ampersand", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("should escape angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
    expect(escapeHtml("<script>alert('xss')</script>")).toContain("&lt;script&gt;");
  });

  it("should escape quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
    expect(escapeHtml("'world'")).toBe("&#39;world&#39;");
  });

  it("should handle combined special characters", () => {
    const html = '<a href="test">Link</a>';
    const escaped = escapeHtml(html);
    expect(escaped).toBe("&lt;a href=&quot;test&quot;&gt;Link&lt;/a&gt;");
  });
});

describe("stripAnsi", () => {
  it("should remove color codes", () => {
    expect(stripAnsi("\x1B[31mred\x1B[0m")).toBe("red");
    expect(stripAnsi("\x1B[32mgreen\x1B[0m")).toBe("green");
  });

  it("should remove bold and other formatting", () => {
    expect(stripAnsi("\x1B[1mbold\x1B[0m")).toBe("bold");
    expect(stripAnsi("\x1B[4munderline\x1B[0m")).toBe("underline");
  });

  it("should handle multiple codes", () => {
    const input = "\x1B[31;1mbold red\x1B[0m";
    expect(stripAnsi(input)).toBe("bold red");
  });

  it("should return string unchanged if no ansi codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("padString", () => {
  it("should pad string at end by default", () => {
    expect(padString("hi", 5)).toBe("hi   ");
    expect(padString("test", 6)).toBe("test  ");
  });

  it("should pad string at start", () => {
    expect(padString("hi", 5, " ", "start")).toBe("   hi");
    expect(padString("42", 5, "0", "start")).toBe("00042");
  });

  it("should use custom padding character", () => {
    expect(padString("test", 8, "-")).toBe("test----");
    expect(padString("x", 5, "*", "start")).toBe("****x");
  });

  it("should return original string if already at or exceeds length", () => {
    expect(padString("hello", 5)).toBe("hello");
    expect(padString("hello world", 5)).toBe("hello world");
  });
});

describe("randomString", () => {
  it("should generate string of specified length", () => {
    expect(randomString(8)).toHaveLength(8);
    expect(randomString(16)).toHaveLength(16);
    expect(randomString(1)).toHaveLength(1);
  });

  it("should use default length of 8", () => {
    expect(randomString()).toHaveLength(8);
  });

  it("should only contain lowercase letters and numbers", () => {
    const str = randomString(100);
    expect(str).toMatch(/^[a-z0-9]+$/);
  });

  it("should generate different strings on each call", () => {
    const str1 = randomString(32);
    const str2 = randomString(32);
    // Very unlikely to be the same
    expect(str1).not.toBe(str2);
  });
});
