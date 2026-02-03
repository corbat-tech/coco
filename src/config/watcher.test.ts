/**
 * Tests for config watcher
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// Store mock watcher for tests to access
let mockWatcher: EventEmitter & { close: ReturnType<typeof vi.fn> };

// Mock fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  watch: vi.fn(() => {
    mockWatcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
    mockWatcher.close = vi.fn();
    return mockWatcher;
  }),
}));

// Mock loader
vi.mock("./loader.js", () => ({
  loadConfig: vi.fn(),
}));

describe("ConfigWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create watcher with default options", async () => {
      const { ConfigWatcher } = await import("./watcher.js");

      const watcher = new ConfigWatcher("/path/to/config.json");

      expect(watcher).toBeDefined();
      expect(watcher.isActive()).toBe(false);
    });

    it("should create watcher with custom options", async () => {
      const { ConfigWatcher } = await import("./watcher.js");

      const watcher = new ConfigWatcher("/path/to/config.json", {
        debounceMs: 200,
        autoReload: false,
      });

      expect(watcher).toBeDefined();
    });
  });

  describe("start", () => {
    it("should start watching the config directory", async () => {
      const fs = await import("node:fs");
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json");
      await watcher.start();

      expect(fs.watch).toHaveBeenCalledWith("/path/to/.coco", expect.any(Function));
      expect(watcher.isActive()).toBe(true);

      watcher.stop();
    });

    it("should load initial config", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      const mockConfig = { project: { name: "test" } } as any;
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const watcher = new ConfigWatcher("/path/to/config.json");
      await watcher.start();

      expect(loadConfig).toHaveBeenCalledWith("/path/to/config.json");
      expect(watcher.getConfig()).toEqual(mockConfig);

      watcher.stop();
    });

    it("should handle missing config file gracefully", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockRejectedValue(new Error("ENOENT"));

      const watcher = new ConfigWatcher("/path/to/config.json");
      await watcher.start();

      expect(watcher.getConfig()).toBeNull();
      expect(watcher.isActive()).toBe(true);

      watcher.stop();
    });

    it("should not start twice", async () => {
      const fs = await import("node:fs");
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/config.json");
      await watcher.start();
      await watcher.start();

      expect(fs.watch).toHaveBeenCalledTimes(1);

      watcher.stop();
    });
  });

  describe("stop", () => {
    it("should stop watching", async () => {
      const fs = await import("node:fs");
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/config.json");
      await watcher.start();

      const fsWatcher = vi.mocked(fs.watch).mock.results[0]?.value;

      watcher.stop();

      expect(fsWatcher.close).toHaveBeenCalled();
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe("createConfigWatcher", () => {
    it("should create a config watcher", async () => {
      const { createConfigWatcher } = await import("./watcher.js");

      const watcher = createConfigWatcher("/path/to/config.json");

      expect(watcher).toBeDefined();
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe("watchConfig", () => {
    it("should watch config and call onChange", async () => {
      const { loadConfig } = await import("./loader.js");
      const { watchConfig } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const onChange = vi.fn();
      const stop = await watchConfig("/path/to/config.json", onChange);

      expect(stop).toBeInstanceOf(Function);

      stop();
    });

    it("should call onError when provided", async () => {
      const { loadConfig } = await import("./loader.js");
      const { watchConfig } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const onChange = vi.fn();
      const onError = vi.fn();
      const stop = await watchConfig("/path/to/config.json", onChange, onError);

      stop();
    });
  });

  describe("file change handling", () => {
    it("should emit change event when config file changes", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      const initialConfig = { project: { name: "initial" } } as any;
      const newConfig = { project: { name: "updated" } } as any;

      vi.mocked(loadConfig)
        .mockResolvedValueOnce(initialConfig)
        .mockResolvedValueOnce(newConfig);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 10 });
      const onChange = vi.fn();
      watcher.on("change", onChange);

      await watcher.start();

      // Simulate file change by calling the watch callback
      // The callback is passed to fs.watch as the second argument
      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      // Wait for debounce
      await vi.advanceTimersByTimeAsync(20);

      expect(onChange).toHaveBeenCalledWith(newConfig);

      watcher.stop();
    });

    it("should not emit change event if config has not changed", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      const config = { project: { name: "same" } } as any;

      vi.mocked(loadConfig).mockResolvedValue(config);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 10 });
      const onChange = vi.fn();
      watcher.on("change", onChange);

      await watcher.start();

      // Simulate file change
      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      await vi.advanceTimersByTimeAsync(20);

      // Should not emit because config is the same
      expect(onChange).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("should ignore changes to other files", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 10 });
      const onChange = vi.fn();
      watcher.on("change", onChange);

      await watcher.start();

      // Simulate change to a different file
      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "other-file.json");

      await vi.advanceTimersByTimeAsync(20);

      expect(onChange).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("should not reload when autoReload is false", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", {
        debounceMs: 10,
        autoReload: false
      });
      const onChange = vi.fn();
      watcher.on("change", onChange);

      await watcher.start();

      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      await vi.advanceTimersByTimeAsync(20);

      // loadConfig should only be called once (initial load)
      expect(loadConfig).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();

      watcher.stop();
    });

    it("should emit error when config reload fails", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig)
        .mockResolvedValueOnce({ project: { name: "initial" } } as any)
        .mockRejectedValueOnce(new Error("Parse error"));

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 10 });
      const onError = vi.fn();
      watcher.on("error", onError);

      await watcher.start();

      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      await vi.advanceTimersByTimeAsync(20);

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe("Parse error");

      watcher.stop();
    });

    it("should emit error with wrapped non-Error", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig)
        .mockResolvedValueOnce({ project: { name: "initial" } } as any)
        .mockRejectedValueOnce("string error");

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 10 });
      const onError = vi.fn();
      watcher.on("error", onError);

      await watcher.start();

      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      await vi.advanceTimersByTimeAsync(20);

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toBe("string error");

      watcher.stop();
    });

    it("should debounce rapid changes", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      const initialConfig = { project: { name: "initial" } } as any;
      const newConfig = { project: { name: "final" } } as any;

      vi.mocked(loadConfig)
        .mockResolvedValueOnce(initialConfig)
        .mockResolvedValue(newConfig);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 50 });
      const onChange = vi.fn();
      watcher.on("change", onChange);

      await watcher.start();

      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;

      // Trigger multiple rapid changes
      watchCallback("change", "config.json");
      await vi.advanceTimersByTimeAsync(20);
      watchCallback("change", "config.json");
      await vi.advanceTimersByTimeAsync(20);
      watchCallback("change", "config.json");

      // Wait for full debounce
      await vi.advanceTimersByTimeAsync(60);

      // Should only call loadConfig twice (initial + one debounced reload)
      expect(loadConfig).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(1);

      watcher.stop();
    });
  });

  describe("watcher error handling", () => {
    it("should emit error when fs watcher errors", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json");
      const onError = vi.fn();
      watcher.on("error", onError);

      await watcher.start();

      // Emit error on the fs watcher
      mockWatcher.emit("error", new Error("FS error"));

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("FS error");

      watcher.stop();
    });
  });

  describe("directory creation", () => {
    it("should create directory if it does not exist", async () => {
      const fs = await import("node:fs");
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json");
      await watcher.start();

      expect(fs.mkdirSync).toHaveBeenCalledWith("/path/to/.coco", { recursive: true });

      watcher.stop();
    });
  });

  describe("stop with debounce timer", () => {
    it("should clear debounce timer on stop", async () => {
      const { loadConfig } = await import("./loader.js");
      const { ConfigWatcher } = await import("./watcher.js");

      vi.mocked(loadConfig).mockResolvedValue({ project: { name: "test" } } as any);

      const watcher = new ConfigWatcher("/path/to/.coco/config.json", { debounceMs: 100 });
      await watcher.start();

      // Trigger a change to start debounce timer
      const fs = await import("node:fs");
      const watchCallback = vi.mocked(fs.watch).mock.calls[0]?.[1] as (eventType: string, filename: string) => void;
      watchCallback("change", "config.json");

      // Stop before debounce completes
      watcher.stop();

      expect(watcher.isActive()).toBe(false);

      // Advance time past debounce - should not throw or cause issues
      await vi.advanceTimersByTimeAsync(200);
    });
  });

  describe("stop when not watching", () => {
    it("should handle stop when watcher is null", async () => {
      const { ConfigWatcher } = await import("./watcher.js");

      const watcher = new ConfigWatcher("/path/to/config.json");

      // Stop without starting - should not throw
      expect(() => watcher.stop()).not.toThrow();
      expect(watcher.isActive()).toBe(false);
    });
  });
});
