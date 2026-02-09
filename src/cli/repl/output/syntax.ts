/**
 * Syntax highlighting for terminal output using highlight.js
 *
 * Uses highlight.js core with selective language imports to keep bundle small.
 * Converts highlight.js HTML span output to chalk ANSI colors.
 */

import chalk from "chalk";
import hljs from "highlight.js/lib/core";

// Import only the languages we need
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Register languages
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

// Language alias map (user-facing name → highlight.js name)
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  docker: "dockerfile",
  md: "markdown",
};

/**
 * Map highlight.js CSS class names to chalk color functions.
 *
 * Based on highlight.js token types:
 * https://highlightjs.readthedocs.io/en/latest/css-classes-reference.html
 */
const TOKEN_COLORS: Record<string, (text: string) => string> = {
  // Keywords & control flow
  keyword: (t) => chalk.blue(t),
  "keyword.control": (t) => chalk.blue(t),

  // Built-in types and literals
  built_in: (t) => chalk.cyan(t),
  type: (t) => chalk.cyan(t),
  class: (t) => chalk.cyan(t),
  "title.class": (t) => chalk.cyan(t),
  "title.class.inherited": (t) => chalk.cyan(t),

  // Functions
  "title.function": (t) => chalk.green(t),
  "title.function.invoke": (t) => chalk.green(t),
  title: (t) => chalk.green(t),

  // Strings
  string: (t) => chalk.yellow(t),
  "template-tag": (t) => chalk.yellow(t),
  "template-variable": (t) => chalk.green(t),

  // Numbers
  number: (t) => chalk.magenta(t),

  // Literals (true, false, null)
  literal: (t) => chalk.magenta(t),

  // Comments
  comment: (t) => chalk.dim(t),
  doctag: (t) => chalk.dim.bold(t),

  // Regular expressions
  regexp: (t) => chalk.red(t),

  // Attributes & properties
  attr: (t) => chalk.cyan(t),
  attribute: (t) => chalk.cyan(t),
  property: (t) => chalk.white(t),

  // Operators & punctuation
  operator: (t) => chalk.dim.white(t),
  punctuation: (t) => chalk.dim.white(t),

  // Meta / preprocessor
  meta: (t) => chalk.dim(t),
  "meta keyword": (t) => chalk.blue(t),
  "meta string": (t) => chalk.yellow(t),

  // Variables & params
  variable: (t) => chalk.white(t),
  "variable.language": (t) => chalk.blue(t),
  params: (t) => chalk.white(t),

  // Tags (HTML/XML)
  tag: (t) => chalk.blue(t),
  name: (t) => chalk.blue(t),

  // Symbols & selectors (CSS, Ruby)
  symbol: (t) => chalk.magenta(t),
  selector: (t) => chalk.green(t),
  "selector-tag": (t) => chalk.blue(t),
  "selector-class": (t) => chalk.green(t),
  "selector-id": (t) => chalk.cyan(t),

  // Additions/deletions (diffs)
  addition: (t) => chalk.green(t),
  deletion: (t) => chalk.red(t),

  // Section headers
  section: (t) => chalk.bold(t),

  // Emphasis
  emphasis: (t) => chalk.italic(t),
  strong: (t) => chalk.bold(t),
};

/**
 * Convert highlight.js HTML output to chalk-colored terminal string.
 *
 * highlight.js outputs: <span class="hljs-keyword">const</span>
 * We convert to: chalk.blue("const")
 *
 * Security: Only processes safe <span class="hljs-*"> tags from highlight.js.
 * All other HTML is stripped before any processing occurs.
 */
function hljsToChalk(html: string): string {
  // SECURITY: Extract only safe hljs spans, discard everything else
  // This prevents any HTML injection since we never process untrusted tags
  const safeSpans: Array<{ match: string; className: string; content: string }> = [];
  const spanRegex = /<span class="hljs-([a-z-]+)">([^<]*)<\/span>/g;
  let match;

  // Extract all safe spans with their positions
  while ((match = spanRegex.exec(html)) !== null) {
    const className = match[1];
    const content = match[2];
    if (className && content !== undefined) {
      safeSpans.push({
        match: match[0],
        className,
        content,
      });
    }
  }

  // Start with the original HTML
  let result = html;

  // Replace each safe span with colored text
  // Process in reverse order to preserve positions
  for (let i = safeSpans.length - 1; i >= 0; i--) {
    const span = safeSpans[i];
    if (!span) continue;
    const colorFn = TOKEN_COLORS[span.className] ?? ((t: string) => t);
    const colored = colorFn(span.content);
    result = result.replace(span.match, colored);
  }

  // Now strip ALL remaining HTML tags completely - anything left is not a safe hljs span
  // Use a loop to ensure complete removal - prevents CodeQL incomplete sanitization warning
  let prevResult = "";
  while (prevResult !== result) {
    prevResult = result;
    result = result.replace(/<[^>]*>/g, "");
  }

  // Decode only safe HTML entities - NEVER decode < or > to prevent tag reintroduction
  result = result
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&"); // Must be last to avoid double-unescaping

  return result;
}

/**
 * Resolve a language alias to a highlight.js language name.
 */
function resolveLanguage(lang: string): string | undefined {
  const normalized = lang.toLowerCase().trim();
  const resolved = LANG_ALIASES[normalized] ?? normalized;

  // Check if highlight.js knows this language
  if (hljs.getLanguage(resolved)) {
    return resolved;
  }

  return undefined;
}

/**
 * Highlight a single line of code for terminal output.
 *
 * Returns the line with chalk ANSI color codes applied.
 * If the language is not supported, returns the line unchanged.
 */
export function highlightLine(line: string, lang: string): string {
  const resolvedLang = resolveLanguage(lang);
  if (!resolvedLang) {
    return line;
  }

  try {
    const result = hljs.highlight(line, { language: resolvedLang });
    return hljsToChalk(result.value);
  } catch {
    // If highlighting fails, return plain text
    return line;
  }
}

/**
 * Highlight a multi-line code block for terminal output.
 *
 * Returns the code with chalk ANSI color codes applied.
 * If the language is not supported, returns the code unchanged.
 */
export function highlightBlock(code: string, lang: string): string {
  const resolvedLang = resolveLanguage(lang);
  if (!resolvedLang) {
    return code;
  }

  try {
    const result = hljs.highlight(code, { language: resolvedLang });
    return hljsToChalk(result.value);
  } catch {
    return code;
  }
}

/**
 * Check if a language is supported for highlighting.
 */
export function isLanguageSupported(lang: string): boolean {
  return resolveLanguage(lang) !== undefined;
}
