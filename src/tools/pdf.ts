/**
 * PDF Reader tool for Corbat-Coco
 * Extract text content from PDF files
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");

/**
 * Maximum pages to process
 */
const DEFAULT_MAX_PAGES = 20;

/**
 * Maximum file size (50MB)
 */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * PDF read output
 */
export interface PdfReadOutput {
  text: string;
  pages: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
  };
  truncated: boolean;
  duration: number;
}

/**
 * Parse page range string
 */
export function parsePageRange(
  rangeStr: string,
  totalPages: number,
): { start: number; end: number } {
  const parts = rangeStr.split("-").map((s) => s.trim());

  if (parts.length === 1) {
    const page = parseInt(parts[0] ?? "", 10);
    if (isNaN(page) || page < 1) {
      return { start: 1, end: totalPages };
    }
    return { start: page, end: page };
  }

  const start = parseInt(parts[0] ?? "", 10) || 1;
  const end = parseInt(parts[1] ?? "", 10) || totalPages;

  return {
    start: Math.max(1, Math.min(start, totalPages)),
    end: Math.max(1, Math.min(end, totalPages)),
  };
}

/**
 * PDF reader tool
 */
export const readPdfTool: ToolDefinition<
  {
    path: string;
    pages?: string;
    maxPages?: number;
  },
  PdfReadOutput
> = defineTool({
  name: "read_pdf",
  description: `Extract text content from a PDF file.

Examples:
- Read entire PDF: { "path": "docs/specification.pdf" }
- Read specific pages: { "path": "report.pdf", "pages": "1-5" }
- Single page: { "path": "manual.pdf", "pages": "3" }`,
  category: "document",
  parameters: z.object({
    path: z.string().min(1).describe("Path to PDF file"),
    pages: z
      .string()
      .optional()
      .describe("Page range (e.g., '1-5', '3')"),
    maxPages: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(DEFAULT_MAX_PAGES)
      .describe("Maximum pages to process"),
  }),
  async execute({ path: filePath, pages, maxPages }) {
    const startTime = performance.now();

    // Resolve and validate path
    const absPath = path.resolve(filePath);

    // Check file exists
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        throw new ToolError(`Path is not a file: ${absPath}`, {
          tool: "read_pdf",
        });
      }
      if (stat.size > MAX_FILE_SIZE) {
        throw new ToolError(
          `File too large (${Math.round(stat.size / 1024 / 1024)}MB, max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
          { tool: "read_pdf" },
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ToolError(`File not found: ${absPath}`, {
          tool: "read_pdf",
        });
      }
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        `Cannot access file: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "read_pdf" },
      );
    }

    // Check extension
    if (!absPath.toLowerCase().endsWith(".pdf")) {
      throw new ToolError("File does not appear to be a PDF", {
        tool: "read_pdf",
      });
    }

    try {
      // Try to use pdf-parse (optional dependency)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = await import("pdf-parse");
      const dataBuffer = await fs.readFile(absPath);

      const pdfData = await pdfParse.default(dataBuffer, {
        max: maxPages,
      });

      let text = pdfData.text;
      let truncated = false;
      const totalPages = pdfData.numpages;

      // Apply page range filter if specified
      if (pages) {
        const range = parsePageRange(pages, totalPages);
        // pdf-parse doesn't support page-by-page extraction easily,
        // so we approximate by splitting on page boundaries
        const pageTexts = text.split(/\f/); // Form feed character separates pages
        if (pageTexts.length > 1) {
          const selectedPages = pageTexts.slice(range.start - 1, range.end);
          text = selectedPages.join("\n\n--- Page Break ---\n\n");
        }
      }

      // Truncate if too long
      if (text.length > 500000) {
        text = text.slice(0, 500000);
        truncated = true;
      }

      return {
        text,
        pages: totalPages,
        metadata: {
          title: pdfData.info?.Title as string | undefined,
          author: pdfData.info?.Author as string | undefined,
          subject: pdfData.info?.Subject as string | undefined,
          creator: pdfData.info?.Creator as string | undefined,
        },
        truncated,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;

      // If pdf-parse is not installed, provide a helpful message
      if (
        (error as Error).message?.includes("Cannot find module") ||
        (error as Error).message?.includes("MODULE_NOT_FOUND")
      ) {
        throw new ToolError(
          "pdf-parse package is not installed. Run: pnpm add pdf-parse",
          { tool: "read_pdf" },
        );
      }

      throw new ToolError(
        `Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "read_pdf", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All document tools (PDF)
 */
export const pdfTools = [readPdfTool];
