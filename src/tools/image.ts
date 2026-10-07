import { resolveModelMigration } from "../providers/model-lifecycle.js";
import { createProvider } from "../providers/index.js";
import { getCatalogDefaultModel, getCatalogModel } from "../providers/catalog.js";
import { PROVIDER_IDS } from "../providers/provider-types.js";
import type { ProviderType } from "../providers/provider-types.js";
/**
 * Image Understanding tool for Corbat-Coco
 * Analyze images using vision-capable LLM providers
 */

import { z } from "zod";
import { constants } from "node:fs";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import { rethrowCancellation } from "../utils/cancellation.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

/**
 * Maximum file size (20MB)
 */
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

/**
 * MIME type mapping
 */
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/**
 * Image understanding output
 */
export interface ImageReadOutput {
  description: string;
  provider: string;
  model: string;
  duration: number;
  imageSize: number;
  format: string;
}

/**
 * Image understanding tool
 */
export const readImageTool: ToolDefinition<
  {
    path: string;
    prompt?: string;
    provider?: ProviderType;
    model?: string;
  },
  ImageReadOutput
> = defineTool({
  name: "read_image",
  description: `Upload an image to the selected cloud vision provider using its API key (default: Anthropic). Requires network authorization and may incur provider charges. Useful for UI screenshots, design mockups, architecture diagrams, and error screenshots.

Examples:
- Describe image: { "path": "screenshot.png" }
- Specific analysis: { "path": "ui-design.png", "prompt": "What UI components are shown? List any accessibility issues." }
- With specific provider: { "path": "error.png", "provider": "anthropic" }`,
  category: "document",
  parameters: z.object({
    path: z.string().min(1).describe("Path to image file"),
    prompt: z
      .string()
      .optional()
      .default("Describe this image in detail. If it's code or a UI, identify the key elements.")
      .describe("Analysis prompt"),
    model: z
      .string()
      .optional()
      .describe("Vision-capable model; defaults to the selected provider catalog default"),
    provider: z
      .enum(PROVIDER_IDS)
      .optional()
      .describe("Cloud provider to upload the image to (default: anthropic)"),
  }),
  async execute({ path: filePath, prompt, provider, model: requestedModel }, context) {
    const signal = context?.signal;
    signal?.throwIfAborted();
    const startTime = performance.now();
    const effectivePrompt =
      prompt ?? "Describe this image in detail. If it's code or a UI, identify the key elements.";

    // Resolve path and validate it's within the working directory
    const absPath = path.resolve(filePath);
    const cwd = process.cwd();
    if (!absPath.startsWith(cwd + path.sep) && absPath !== cwd) {
      throw new ToolError(
        `Path traversal denied: '${filePath}' resolves outside the project directory`,
        { tool: "read_image" },
      );
    }
    const ext = path.extname(absPath).toLowerCase();

    // Validate format
    if (!SUPPORTED_FORMATS.has(ext)) {
      throw new ToolError(
        `Unsupported image format '${ext}'. Supported: ${Array.from(SUPPORTED_FORMATS).join(", ")}`,
        { tool: "read_image" },
      );
    }

    // Canonical containment before reading bytes or consulting cloud credentials.
    let imageBuffer: Buffer;
    try {
      const root = await fs.realpath(cwd);
      const canonical = await fs.realpath(absPath);
      if (!canonical.startsWith(root + path.sep)) {
        throw new ToolError("Path traversal denied: image resolves outside the project directory", {
          tool: "read_image",
        });
      }
      const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) {
          throw new ToolError(`Path must be a regular image file with one link: ${absPath}`, {
            tool: "read_image",
          });
        }
        if (stat.size > MAX_IMAGE_SIZE)
          throw new ToolError("Image too large (max 20MB)", { tool: "read_image" });
        signal?.throwIfAborted();
        imageBuffer = await handle.readFile({ signal });
        if (imageBuffer.length > MAX_IMAGE_SIZE)
          throw new ToolError("Image too large (max 20MB)", { tool: "read_image" });
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new ToolError(`File not found: ${absPath}`, { tool: "read_image" });
      throw error;
    }

    signal?.throwIfAborted();
    const base64 = imageBuffer.toString("base64");
    const mimeType = MIME_TYPES[ext] ?? "image/png";

    // Determine provider
    const selectedProvider = provider ?? "anthropic";
    let description: string;
    let model: string;

    try {
      const migration = resolveModelMigration(
        selectedProvider,
        requestedModel ?? getCatalogDefaultModel(selectedProvider),
      );
      model = migration.model;
      if (migration.warning) console.warn(migration.warning);
      if (!getCatalogModel(selectedProvider, model)?.capabilities.includes("vision"))
        throw new ToolError(`Model ${selectedProvider}/${model} is not verified for image input.`, {
          tool: "read_image",
        });
      const adapter = await createProvider(selectedProvider, { model });
      const response = await adapter.chat(
        [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: effectivePrompt },
            ],
          },
        ],
        { maxTokens: 4096, signal },
      );
      description = response.content;
    } catch (error) {
      rethrowCancellation(error, signal);
      if (error instanceof ToolError) throw error;

      // Check for missing SDK
      if (
        (error as Error).message?.includes("Cannot find module") ||
        (error as Error).message?.includes("MODULE_NOT_FOUND")
      ) {
        const pkgMap: Record<string, string> = {
          anthropic: "@anthropic-ai/sdk",
          openai: "openai",
          gemini: "@google/genai",
        };
        const pkg = pkgMap[selectedProvider] ?? selectedProvider;
        throw new ToolError(`Provider SDK not installed. Run: pnpm add ${pkg}`, {
          tool: "read_image",
        });
      }

      throw new ToolError(
        `Image analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "read_image", cause: error instanceof Error ? error : undefined },
      );
    }

    signal?.throwIfAborted();
    return {
      description,
      provider: selectedProvider,
      model,
      duration: performance.now() - startTime,
      imageSize: imageBuffer.length,
      format: ext.slice(1),
    };
  },
});

/**
 * All image tools
 */
export const imageTools = [readImageTool];
