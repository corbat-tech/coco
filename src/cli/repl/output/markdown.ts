/**
 * Markdown renderer for terminal output
 * Uses marked + marked-terminal for beautiful markdown rendering
 */

import { Marked } from "marked";
import { markedTerminal, type TerminalRendererOptions } from "marked-terminal";
import chalk from "chalk";
import stringWidth from "string-width";

/**
 * Custom terminal renderer options
 */
const terminalOptions: TerminalRendererOptions = {
  // Code blocks
  code: chalk.bgGray.white,
  blockquote: chalk.gray.italic,

  // HTML elements
  html: chalk.gray,

  // Headings
  heading: chalk.bold.green,
  firstHeading: chalk.bold.magenta,

  // Horizontal rule
  hr: chalk.dim,

  // Lists
  listitem: chalk.white,

  // Tables
  table: chalk.white,
  tableOptions: {
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "╭",
      "top-right": "╮",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "╰",
      "bottom-right": "╯",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    // Use string-width for correct column measurement with emoji/CJK characters
    // Without this, emoji (2 visual columns) are counted as 1, causing misalignment
    stringLength: stringWidth,
  },

  // Emphasis
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.cyan,
  del: chalk.strikethrough,

  // Links
  link: chalk.blue.underline,
  href: chalk.blue.dim,

  // Text
  text: chalk.white,

  // Indentation
  unescape: true,
  width: 80,
  showSectionPrefix: false,
  reflowText: true,
  tab: 2,

  // Emoji support
  emoji: true,
};

/**
 * Create a marked instance with terminal renderer
 */
const marked = new Marked();
// @ts-expect-error - marked-terminal types are slightly out of sync with marked v15
marked.use(markedTerminal(terminalOptions));

/**
 * Unescape HTML entities for terminal display.
 * marked encodes entities (e.g. &lt; &gt;) for browser safety, but in a
 * terminal we always want the raw characters so XML tags render correctly.
 * &amp; must be decoded last to avoid double-unescaping (e.g. &amp;lt; → &lt;).
 */
function unescapeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Render markdown to terminal-formatted string
 */
export function renderMarkdown(markdown: string): string {
  try {
    const rendered = marked.parse(markdown);
    if (typeof rendered === "string") {
      // Unescape HTML entities: marked encodes < > & for browser contexts,
      // but terminal output needs raw characters (e.g. <thinking>, <tag>)
      return unescapeHtmlEntities(rendered);
    }
    // If it returns a Promise (shouldn't with sync parsing), return original
    return markdown;
  } catch (error) {
    // Fallback to original text if parsing fails
    console.error("Markdown parsing error:", error);
    return markdown;
  }
}

/**
 * Check if text contains markdown formatting
 */
export function containsMarkdown(text: string): boolean {
  // Check for common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s/m, // Headers
    /\*\*[^*]+\*\*/, // Bold
    /\*[^*]+\*/, // Italic
    /`[^`]+`/, // Inline code
    /```[\s\S]*?```/, // Code blocks
    /^\s*[-*+]\s/m, // Unordered lists
    /^\s*\d+\.\s/m, // Ordered lists
    /\[.+\]\(.+\)/, // Links
    /^\s*>/m, // Blockquotes
    /\|.+\|/, // Tables
    /^---$/m, // Horizontal rule
  ];

  return markdownPatterns.some((pattern) => pattern.test(text));
}

/**
 * Render markdown with custom styling for assistant responses
 * Adds indentation and styling appropriate for chat context
 */
export function renderAssistantMarkdown(markdown: string): string {
  const rendered = renderMarkdown(markdown);

  // Add slight indentation for assistant responses
  return rendered
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

/**
 * Simple inline markdown rendering for streaming
 * Handles basic formatting without full markdown parsing
 */
export function renderInlineMarkdown(text: string): string {
  return (
    text
      // Bold **text**
      .replace(/\*\*([^*]+)\*\*/g, (_, p1: string) => chalk.bold(p1))
      // Italic *text* (not inside bold)
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, p1: string) => chalk.italic(p1))
      // Strikethrough ~~text~~
      .replace(/~~([^~]+)~~/g, (_, p1: string) => chalk.strikethrough(p1))
      // Inline code `code`
      .replace(/`([^`]+)`/g, (_, p1: string) => chalk.cyan(p1))
      // Links [text](url)
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text: string, url: string) => chalk.blue.underline(text) + chalk.dim(` (${url})`),
      )
  );
}

export { marked };
