/**
 * Web Fetch tool for Corbat-Coco
 * Fetch URLs and convert HTML to clean markdown
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError, TimeoutError } from "../utils/errors.js";

/**
 * Default timeout (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Default max content length (50K chars)
 */
const DEFAULT_MAX_LENGTH = 50000;

/**
 * Maximum response size to download (10MB)
 */
const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024;

/**
 * Blocked URL schemes
 */
const BLOCKED_SCHEMES = ["file:", "ftp:", "data:", "javascript:"];

/**
 * Private IP patterns to block (SSRF protection)
 */
const PRIVATE_IP_PATTERNS = [
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/localhost/i,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
];

/**
 * Web fetch result interface
 */
export interface WebFetchOutput {
  title: string;
  content: string;
  url: string;
  contentType: string;
  wordCount: number;
  truncated: boolean;
  duration: number;
  metadata: {
    description?: string;
    author?: string;
    publishedDate?: string;
  };
}

/**
 * Validate URL for safety
 */
export function validateUrl(url: string): void {
  // Check blocked schemes
  for (const scheme of BLOCKED_SCHEMES) {
    if (url.toLowerCase().startsWith(scheme)) {
      throw new ToolError(`URL scheme '${scheme}' is not allowed`, {
        tool: "web_fetch",
      });
    }
  }

  // Must be http or https
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new ToolError("Only http:// and https:// URLs are supported", {
      tool: "web_fetch",
    });
  }

  // Check private IPs (SSRF protection)
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(url)) {
      throw new ToolError(
        "Access to private/internal network addresses is not allowed",
        { tool: "web_fetch" },
      );
    }
  }
}

/**
 * Extract metadata from HTML
 */
export function extractMetadata(html: string): {
  title: string;
  description?: string;
  author?: string;
  publishedDate?: string;
} {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";

  // Extract meta description
  const descMatch = html.match(
    /<meta\s+(?:[^>]*\s+)?(?:name|property)=["'](?:description|og:description)["']\s+content=["']([\s\S]*?)["']/i,
  );
  const description = descMatch?.[1]?.trim() ?? undefined;

  // Extract author
  const authorMatch = html.match(
    /<meta\s+(?:[^>]*\s+)?name=["']author["']\s+content=["']([\s\S]*?)["']/i,
  );
  const author = authorMatch?.[1]?.trim() ?? undefined;

  // Extract published date
  const dateMatch = html.match(
    /<meta\s+(?:[^>]*\s+)?(?:name|property)=["'](?:article:published_time|datePublished|date)["']\s+content=["']([\s\S]*?)["']/i,
  );
  const publishedDate = dateMatch?.[1]?.trim() ?? undefined;

  return { title, description, author, publishedDate };
}

/**
 * Remove unwanted HTML elements
 */
function removeUnwantedElements(html: string): string {
  // Remove script, style, nav, header, footer, aside, noscript elements
  const tagsToRemove = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "noscript",
    "iframe",
    "svg",
    "form",
  ];

  let cleaned = html;
  for (const tag of tagsToRemove) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    cleaned = cleaned.replace(regex, "");
  }

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  return cleaned;
}

/**
 * Extract main content from HTML
 */
function extractMainContent(html: string): string {
  // Try to find main content area in priority order
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of contentSelectors) {
    const match = html.match(pattern);
    if (match && (match[1] ?? "").trim().length > 200) {
      return match[1] ?? "";
    }
  }

  // Fallback: use body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] ?? html;
}

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  let md = html;

  // Handle headings (h1-h6)
  for (let i = 1; i <= 6; i++) {
    const prefix = "#".repeat(i);
    const regex = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi");
    md = md.replace(regex, (_, content) => {
      const text = content.replace(/<[^>]*>/g, "").trim();
      return text ? `\n\n${prefix} ${text}\n\n` : "";
    });
  }

  // Handle links
  md = md.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = text.replace(/<[^>]*>/g, "").trim();
    if (!cleanText) return "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return cleanText;
    return `[${cleanText}](${href})`;
  });

  // Handle images
  md = md.replace(
    /<img\s+[^>]*(?:alt=["']([^"']*)["'])?[^>]*(?:src=["']([^"']+)["'])?[^>]*\/?>/gi,
    (_, alt, src) => {
      return src ? `![${alt ?? ""}](${src})` : "";
    },
  );

  // Handle code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    const decoded = code
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]*>/g, "");
    return `\n\n\`\`\`\n${decoded.trim()}\n\`\`\`\n\n`;
  });

  // Handle inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
    const decoded = code
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]*>/g, "");
    return `\`${decoded}\``;
  });

  // Handle unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return (
      "\n" +
      items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
        const text = item.replace(/<[^>]*>/g, "").trim();
        return text ? `- ${text}\n` : "";
      }) +
      "\n"
    );
  });

  // Handle ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let counter = 0;
    return (
      "\n" +
      items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
        counter++;
        const text = item.replace(/<[^>]*>/g, "").trim();
        return text ? `${counter}. ${text}\n` : "";
      }) +
      "\n"
    );
  });

  // Handle blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const text = content.replace(/<[^>]*>/g, "").trim();
    return text
      ? "\n" +
          text
            .split("\n")
            .map((line: string) => `> ${line.trim()}`)
            .join("\n") +
          "\n"
      : "";
  });

  // Handle paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    const text = content.replace(/<[^>]*>/g, "").trim();
    return text ? `\n\n${text}\n\n` : "";
  });

  // Handle line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Handle bold
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, text) => `**${text.trim()}**`);

  // Handle italic
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, text) => `*${text.trim()}*`);

  // Handle horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Handle tables (basic)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    let isFirstRow = true;

    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRegex.exec(rowMatch[1] ?? "")) !== null) {
        cells.push((cellMatch[1] ?? "").replace(/<[^>]*>/g, "").trim());
      }

      if (cells.length > 0) {
        rows.push(`| ${cells.join(" | ")} |`);
        if (isFirstRow) {
          rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          isFirstRow = false;
        }
      }
    }

    return rows.length > 0 ? `\n\n${rows.join("\n")}\n\n` : "";
  });

  // Remove remaining HTML tags
  md = md.replace(/<[^>]*>/g, "");

  // Decode HTML entities
  md = md
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Clean up excessive whitespace
  md = md.replace(/\n{4,}/g, "\n\n\n");
  md = md.replace(/[ \t]+$/gm, "");
  md = md.trim();

  return md;
}

/**
 * Web fetch tool
 */
export const webFetchTool: ToolDefinition<
  {
    url: string;
    extractContent?: boolean;
    maxLength?: number;
    timeout?: number;
  },
  WebFetchOutput
> = defineTool({
  name: "web_fetch",
  description: `Fetch a URL and convert its content to clean markdown. Extracts main content, strips navigation/ads, and returns readable text.

Examples:
- Fetch documentation: { "url": "https://docs.example.com/api" }
- Raw fetch: { "url": "https://api.example.com/data.json", "extractContent": false }
- With limits: { "url": "https://long-page.com/article", "maxLength": 20000 }`,
  category: "web",
  parameters: z.object({
    url: z.string().url().describe("URL to fetch"),
    extractContent: z
      .boolean()
      .optional()
      .default(true)
      .describe("Extract and clean main content (true) or return raw (false)"),
    maxLength: z
      .number()
      .min(1000)
      .max(200000)
      .optional()
      .default(DEFAULT_MAX_LENGTH)
      .describe("Maximum content length in characters"),
    timeout: z
      .number()
      .min(1000)
      .max(120000)
      .optional()
      .default(DEFAULT_TIMEOUT_MS)
      .describe("Timeout in milliseconds"),
  }),
  async execute({ url, extractContent, maxLength, timeout }) {
    const startTime = performance.now();
    const effectiveMaxLength = maxLength ?? DEFAULT_MAX_LENGTH;
    const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_MS;

    // Validate URL safety
    validateUrl(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Corbat-Coco/0.3.0",
          Accept: "text/html,application/json,text/plain,*/*",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new ToolError(`HTTP ${response.status}: ${response.statusText}`, {
          tool: "web_fetch",
        });
      }

      const contentType =
        response.headers.get("content-type") ?? "text/plain";

      // Read response body with size limit
      const reader = response.body?.getReader();
      let body = "";
      let bytesRead = 0;

      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          bytesRead += value.length;
          if (bytesRead > MAX_DOWNLOAD_SIZE) {
            reader.cancel();
            break;
          }

          body += decoder.decode(value, { stream: true });
        }
      }

      let title = "";
      let content: string;
      let truncated = false;
      const metadata: WebFetchOutput["metadata"] = {};

      if (contentType.includes("text/html") && extractContent) {
        // Extract metadata before cleaning
        const meta = extractMetadata(body);
        title = meta.title;
        metadata.description = meta.description;
        metadata.author = meta.author;
        metadata.publishedDate = meta.publishedDate;

        // Clean and convert HTML
        const cleaned = removeUnwantedElements(body);
        const mainContent = extractMainContent(cleaned);
        content = htmlToMarkdown(mainContent);
      } else if (contentType.includes("application/json")) {
        // Pretty-print JSON
        try {
          const parsed = JSON.parse(body);
          content = JSON.stringify(parsed, null, 2);
        } catch {
          content = body;
        }
        title = url;
      } else {
        // Plain text or other
        content = body;
        title = url;
      }

      // Truncate if needed
      if (content.length > effectiveMaxLength) {
        content = content.slice(0, effectiveMaxLength);
        truncated = true;
      }

      const wordCount = content.split(/\s+/).filter(Boolean).length;

      return {
        title,
        content,
        url,
        contentType,
        wordCount,
        truncated,
        duration: performance.now() - startTime,
        metadata,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ToolError || error instanceof TimeoutError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${effectiveTimeout}ms`, {
          timeoutMs: effectiveTimeout,
          operation: `web_fetch: ${url}`,
        });
      }

      throw new ToolError(
        `Web fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "web_fetch", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});
