/**
 * HTTP tools for Corbat-Coco
 * Make HTTP requests to external APIs
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError, TimeoutError } from "../utils/errors.js";

/**
 * Default timeout (30 seconds)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Maximum response size (5MB)
 */
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

/**
 * HTTP response interface
 */
export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  truncated: boolean;
}

/**
 * HTTP fetch tool
 */
export const httpFetchTool: ToolDefinition<
  {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    maxSize?: number;
  },
  HttpResponse
> = defineTool({
  name: "http_fetch",
  description: `Make an HTTP request to a URL.

Examples:
- GET request: { "url": "https://api.example.com/users" }
- POST with body: { "url": "https://api.example.com/users", "method": "POST", "body": "{\\"name\\":\\"John\\"}" }
- With headers: { "url": "https://api.example.com/data", "headers": { "Authorization": "Bearer token" } }
- With timeout: { "url": "https://slow-api.com/data", "timeout": 60000 }`,
  category: "bash", // Using bash category as it's for external operations
  parameters: z.object({
    url: z.string().url().describe("URL to fetch"),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
      .optional()
      .default("GET")
      .describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers"),
    body: z.string().optional().describe("Request body (for POST, PUT, PATCH)"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
    maxSize: z.number().optional().describe("Max response size in bytes"),
  }),
  async execute({ url, method, headers, body, timeout, maxSize }) {
    const startTime = performance.now();
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = maxSize ?? MAX_RESPONSE_SIZE;

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: method ?? "GET",
          headers: {
            "User-Agent": "Corbat-Coco/0.1.0",
            ...headers,
          },
          // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- Body is conditionally set only for non-GET methods
          body: method && ["POST", "PUT", "PATCH"].includes(method) ? body : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Read response with size limit
        const reader = response.body?.getReader();
        let responseBody = "";
        let truncated = false;
        let bytesRead = 0;

        if (reader) {
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            bytesRead += value.length;

            if (bytesRead > maxBytes) {
              truncated = true;
              responseBody += decoder.decode(value.slice(0, maxBytes - (bytesRead - value.length)));
              reader.cancel();
              break;
            }

            responseBody += decoder.decode(value, { stream: true });
          }
        }

        // Convert headers to plain object
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          duration: performance.now() - startTime,
          truncated,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, {
          timeoutMs,
          operation: `${method ?? "GET"} ${url}`,
        });
      }

      throw new ToolError(
        `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "http_fetch", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * HTTP JSON fetch tool (convenience wrapper)
 */
export const httpJsonTool: ToolDefinition<
  {
    url: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    data?: Record<string, unknown>;
    timeout?: number;
  },
  {
    status: number;
    data: unknown;
    duration: number;
  }
> = defineTool({
  name: "http_json",
  description: `Make an HTTP request and parse JSON response (convenience wrapper).

Examples:
- GET JSON: { "url": "https://api.example.com/user/1" } → { "status": 200, "data": { "name": "John" } }
- POST JSON: { "url": "https://api.example.com/users", "method": "POST", "data": { "name": "Jane" } }
- With auth: { "url": "https://api.example.com/me", "headers": { "Authorization": "Bearer xyz" } }`,
  category: "bash",
  parameters: z.object({
    url: z.string().url().describe("URL to fetch"),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .optional()
      .default("GET")
      .describe("HTTP method"),
    headers: z.record(z.string(), z.string()).optional().describe("Additional headers"),
    data: z.record(z.string(), z.unknown()).optional().describe("JSON data to send"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute({ url, method, headers, data, timeout }) {
    const startTime = performance.now();

    try {
      const response = await httpFetchTool.execute({
        url,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: data ? JSON.stringify(data) : undefined,
        timeout,
      });

      let parsedData: unknown;
      try {
        parsedData = response.body ? JSON.parse(response.body) : null;
      } catch {
        parsedData = response.body;
      }

      return {
        status: response.status,
        data: parsedData,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ToolError || error instanceof TimeoutError) {
        throw error;
      }

      throw new ToolError(
        `HTTP JSON request failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "http_json", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All HTTP tools
 */
export const httpTools = [httpFetchTool, httpJsonTool];
