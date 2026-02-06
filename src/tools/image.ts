/**
 * Image Understanding tool for Corbat-Coco
 * Analyze images using vision-capable LLM providers
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

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
    provider?: "anthropic" | "openai" | "gemini";
  },
  ImageReadOutput
> = defineTool({
  name: "read_image",
  description: `Analyze an image using a vision-capable AI model. Useful for UI screenshots, design mockups, architecture diagrams, and error screenshots.

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
    provider: z
      .enum(["anthropic", "openai", "gemini"])
      .optional()
      .describe("LLM provider to use (default: auto-detect from config)"),
  }),
  async execute({ path: filePath, prompt, provider }) {
    const startTime = performance.now();
    const effectivePrompt = prompt ?? "Describe this image in detail. If it's code or a UI, identify the key elements.";

    // Resolve path
    const absPath = path.resolve(filePath);
    const ext = path.extname(absPath).toLowerCase();

    // Validate format
    if (!SUPPORTED_FORMATS.has(ext)) {
      throw new ToolError(
        `Unsupported image format '${ext}'. Supported: ${Array.from(SUPPORTED_FORMATS).join(", ")}`,
        { tool: "read_image" },
      );
    }

    // Check file exists and size
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) {
        throw new ToolError(`Path is not a file: ${absPath}`, {
          tool: "read_image",
        });
      }
      if (stat.size > MAX_IMAGE_SIZE) {
        throw new ToolError(
          `Image too large (${Math.round(stat.size / 1024 / 1024)}MB, max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
          { tool: "read_image" },
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ToolError(`File not found: ${absPath}`, {
          tool: "read_image",
        });
      }
      if (error instanceof ToolError) throw error;
      throw error;
    }

    // Read image as base64
    const imageBuffer = await fs.readFile(absPath);
    const base64 = imageBuffer.toString("base64");
    const mimeType = MIME_TYPES[ext] ?? "image/png";

    // Determine provider
    const selectedProvider = provider ?? "anthropic";
    let description: string;
    let model: string;

    try {
      if (selectedProvider === "anthropic") {
        model = "claude-sonnet-4-20250514";

        // Use Anthropic SDK
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic();

        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: effectivePrompt,
                },
              ],
            },
          ],
        });

        description =
          response.content
            .filter((block) => block.type === "text")
            .map((block) => (block as { type: "text"; text: string }).text)
            .join("\n") || "No description generated";
      } else if (selectedProvider === "openai") {
        model = "gpt-4o";

        const { default: OpenAI } = await import("openai");
        const client = new OpenAI();

        // OpenAI vision API - use type assertion for image_url content part
        const openaiMessages = [
          {
            role: "user" as const,
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64}`,
                },
              },
              {
                type: "text",
                text: effectivePrompt,
              },
            ],
          },
        ];

        const response = await client.chat.completions.create({
          model,
          max_tokens: 4096,
          messages: openaiMessages,
        } as Parameters<typeof client.chat.completions.create>[0]) as unknown as {
          choices: Array<{ message: { content: string | null } }>;
        };

        description =
          response.choices[0]?.message?.content ?? "No description generated";
      } else if (selectedProvider === "gemini") {
        model = "gemini-2.0-flash";

        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new ToolError(
            "GOOGLE_API_KEY or GEMINI_API_KEY environment variable required for Gemini",
            { tool: "read_image" },
          );
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const genModel = genAI.getGenerativeModel({ model });

        const result = await genModel.generateContent([
          effectivePrompt,
          {
            inlineData: {
              data: base64,
              mimeType,
            },
          },
        ]);

        description =
          result.response.text() ?? "No description generated";
      } else {
        throw new ToolError(`Unsupported provider: ${selectedProvider}`, {
          tool: "read_image",
        });
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;

      // Check for missing SDK
      if (
        (error as Error).message?.includes("Cannot find module") ||
        (error as Error).message?.includes("MODULE_NOT_FOUND")
      ) {
        throw new ToolError(
          `Provider SDK not installed for '${selectedProvider}'. Check your dependencies.`,
          { tool: "read_image" },
        );
      }

      throw new ToolError(
        `Image analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "read_image", cause: error instanceof Error ? error : undefined },
      );
    }

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
