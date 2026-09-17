import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
import stringWidth from "string-width";
import {
  renderStreamChunk,
  resetLineBuffer,
  getRawMarkdown,
  getLastBlock,
  renderEditPreview,
} from "./renderer.js";

describe("terminal rendering with real Unicode and ANSI formatting", () => {
  let rows: string[];
  let columns: PropertyDescriptor | undefined;
  beforeEach(() => {
    rows = [];
    resetLineBuffer();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation((...args) => rows.push(args.map(String).join(" ")));
    columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", { value: 16, configurable: true });
  });
  afterEach(() => {
    resetLineBuffer();
    vi.restoreAllMocks();
    if (columns) Object.defineProperty(process.stdout, "columns", columns);
    else Reflect.deleteProperty(process.stdout, "columns");
  });
  const render = (text: string) => {
    for (const fragment of [text.slice(0, 3), text.slice(3)])
      renderStreamChunk({ type: "text", text: fragment });
    renderStreamChunk({ type: "done" });
    return rows.map(stripVTControlCharacters);
  };
  it.each(["界".repeat(25), "🥥".repeat(25), "👩‍💻".repeat(25), "e\u0301".repeat(40)])(
    "wraps graphemes without changing content: %s",
    (text) => {
      const output = render(text + "\n");
      expect(output.join("").normalize("NFC")).toBe(text.normalize("NFC"));
      expect(getRawMarkdown()).toContain(text);
      expect(output.every((line) => stringWidth(line) <= 16)).toBe(true);
      expect(output.some((line) => line.includes("�"))).toBe(false);
    },
  );
  it("wraps styled multilingual text and retains raw markdown for copying", () => {
    const text = "**界界界界界界界界界界界界界界界界**\n";
    const output = render(text);
    expect(output.join("")).toBe("界".repeat(16));
    expect(output.every((line) => stringWidth(line) <= 16)).toBe(true);
    expect(getRawMarkdown()).toContain(text);
  });
  it("keeps full code for copy while capping the displayed preview", () => {
    const code = Array.from({ length: 70 }, (_, i) => `const value${i} = ${i};`);
    const output = render("```js\n" + code.join("\n") + "\n```\n");
    expect(output.some((line) => line.includes("more lines"))).toBe(true);
    expect(getLastBlock()?.content).toBe(code.join("\n"));
  });
  it("preserves both sides of a multilingual edit preview", () => {
    const preview = stripVTControlCharacters(
      renderEditPreview("const café = 'old';\n", "const café = '🥥';\n"),
    );
    expect(preview).toContain("old");
    expect(preview).toContain("🥥");
    expect(preview).toContain("café");
  });
  it("renders nested Markdown code and tables without dropping the source for copy", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    const source =
      "# Result\n| Name | State |\n| --- | --- |\n| café | pending |\n\n~~~js\nconst coconut = '🥥';\n~~~\nFinished.";
    const output = render("````markdown\n" + source + "\n````\n").join("\n");
    expect(output).toContain("café");
    expect(output).toContain("pending");
    expect(output).toContain("coconut");
    expect(output).toContain("🥥");
    expect(output).toContain("Finished.");
    expect(getLastBlock()?.content).toBe(source);
  });
  it("flushes an unfinished fenced response and stops its streaming indicator", () => {
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    vi.useFakeTimers();
    try {
      const output = render(
        "~~~markdown\n# Partial result\nThe provider stopped before closing the fence.",
      );
      expect(output.join("\n")).toContain("Partial result");
      expect(output.join("\n")).toContain("provider stopped");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves actual ANSI styling boundaries while wrapping wide text", () => {
    const output = render("\x1b[31m" + "界".repeat(30) + "\x1b[0m\n");
    expect(output.join("")).toBe("界".repeat(30));
    expect(output.every((line) => stringWidth(line) <= 16)).toBe(true);
    expect(rows.some((line) => line.includes("\x1b[31m"))).toBe(true);
  });
});
