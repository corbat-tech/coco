/**
 * Tests for HTTP tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("httpFetchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct metadata", async () => {
    const { httpFetchTool } = await import("./http.js");
    expect(httpFetchTool.name).toBe("http_fetch");
    expect(httpFetchTool.category).toBe("bash");
    expect(httpFetchTool.description).toContain("HTTP");
  });

  it("should validate parameters", async () => {
    const { httpFetchTool } = await import("./http.js");

    const result = httpFetchTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const invalidUrl = httpFetchTool.parameters.safeParse({ url: "not-a-url" });
    expect(invalidUrl.success).toBe(false);

    const validResult = httpFetchTool.parameters.safeParse({ url: "https://example.com" });
    expect(validResult.success).toBe(true);
  });

  it("should make GET request by default", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode("Hello World"),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpFetchTool } = await import("./http.js");
    const resultPromise = httpFetchTool.execute({ url: "https://example.com" });

    // Run pending timers
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "User-Agent": "Corbat-Coco/0.1.0",
        }),
      })
    );
    expect(result.status).toBe(200);
    expect(result.body).toBe("Hello World");
    expect(result.truncated).toBe(false);
  });

  it("should make POST request with body", async () => {
    const mockResponse = {
      status: 201,
      statusText: "Created",
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('{"id": 1}'),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpFetchTool } = await import("./http.js");
    const resultPromise = httpFetchTool.execute({
      url: "https://api.example.com/data",
      method: "POST",
      body: '{"name": "test"}',
      headers: { "Content-Type": "application/json" },
    });

    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        method: "POST",
        body: '{"name": "test"}',
      })
    );
    expect(result.status).toBe(201);
  });

  it("should handle timeout", async () => {
    vi.useRealTimers(); // Use real timers for this test

    // Make fetch reject with AbortError immediately
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);

    const { httpFetchTool } = await import("./http.js");

    await expect(
      httpFetchTool.execute({
        url: "https://slow.example.com",
        timeout: 50,
      })
    ).rejects.toThrow(/timed out/i);

    vi.useFakeTimers(); // Restore fake timers
  });

  it("should truncate large responses", async () => {
    // Create a large response
    const largeBody = "x".repeat(1000);
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(largeBody),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpFetchTool } = await import("./http.js");
    const resultPromise = httpFetchTool.execute({
      url: "https://example.com",
      maxSize: 100,
    });

    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(100);
  });

  it("should handle fetch error", async () => {
    vi.useRealTimers(); // Use real timers for this test

    mockFetch.mockRejectedValue(new Error("Network error"));

    const { httpFetchTool } = await import("./http.js");

    await expect(
      httpFetchTool.execute({
        url: "https://bad.example.com",
      })
    ).rejects.toThrow(/HTTP request failed/);

    vi.useFakeTimers(); // Restore fake timers
  });

  it("should support custom headers", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpFetchTool } = await import("./http.js");
    const resultPromise = httpFetchTool.execute({
      url: "https://example.com",
      headers: { Authorization: "Bearer token123" },
    });

    await vi.runAllTimersAsync();

    await resultPromise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token123",
        }),
      })
    );
  });
});

describe("httpJsonTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have correct metadata", async () => {
    const { httpJsonTool } = await import("./http.js");
    expect(httpJsonTool.name).toBe("http_json");
    expect(httpJsonTool.category).toBe("bash");
  });

  it("should validate parameters", async () => {
    const { httpJsonTool } = await import("./http.js");

    const result = httpJsonTool.parameters.safeParse({});
    expect(result.success).toBe(false);

    const validResult = httpJsonTool.parameters.safeParse({ url: "https://api.example.com" });
    expect(validResult.success).toBe(true);
  });

  it("should make JSON request and parse response", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('{"name": "test", "value": 42}'),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpJsonTool } = await import("./http.js");
    const resultPromise = httpJsonTool.execute({
      url: "https://api.example.com/data",
    });

    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ name: "test", value: 42 });
  });

  it("should send JSON data", async () => {
    const mockResponse = {
      status: 201,
      statusText: "Created",
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode('{"id": 1}'),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpJsonTool } = await import("./http.js");
    const resultPromise = httpJsonTool.execute({
      url: "https://api.example.com/data",
      method: "POST",
      data: { name: "test" },
    });

    await vi.runAllTimersAsync();

    await resultPromise;

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        method: "POST",
        body: '{"name":"test"}',
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
      })
    );
  });

  it("should handle non-JSON response gracefully", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode("Not JSON"),
            })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
        }),
      },
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { httpJsonTool } = await import("./http.js");
    const resultPromise = httpJsonTool.execute({
      url: "https://example.com",
    });

    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.data).toBe("Not JSON");
  });
});

describe("httpTools", () => {
  it("should export all HTTP tools", async () => {
    const { httpTools } = await import("./http.js");

    expect(httpTools).toBeDefined();
    expect(httpTools.length).toBe(2);
    expect(httpTools.some((t) => t.name === "http_fetch")).toBe(true);
    expect(httpTools.some((t) => t.name === "http_json")).toBe(true);
  });
});
