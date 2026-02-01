/**
 * Tests for logger utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("tslog", () => ({
  Logger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    getSubLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    attachTransport: vi.fn(),
  })),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      appendFileSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a logger with default config", async () => {
    const { createLogger } = await import("./logger.js");
    const { Logger } = await import("tslog");

    const logger = createLogger();

    expect(Logger).toHaveBeenCalled();
    expect(logger).toBeDefined();
  });

  it("should create a logger with custom config", async () => {
    const { createLogger } = await import("./logger.js");
    const { Logger } = await import("tslog");

    createLogger({
      name: "custom",
      level: "debug",
      prettyPrint: false,
    });

    expect(Logger).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom",
        minLevel: 2, // debug level
      })
    );
  });

  it("should setup file logging when enabled", async () => {
    const { createLogger } = await import("./logger.js");

    const logger = createLogger({
      logToFile: true,
      logDir: "/test/logs",
    });

    expect(logger.attachTransport).toHaveBeenCalled();
  });

  it("should create log directory if it does not exist", async () => {
    const fs = await import("node:fs");
    // Mock existsSync to return false
    (fs.default.existsSync as any).mockReturnValueOnce(false);

    const { createLogger } = await import("./logger.js");

    const logger = createLogger({
      logToFile: true,
      logDir: "/test/logs",
    });

    expect(fs.default.mkdirSync).toHaveBeenCalledWith("/test/logs", { recursive: true });
    expect(logger).toBeDefined();
  });

  it("should call file transport when logging", async () => {
    const fs = await import("node:fs");
    const { createLogger } = await import("./logger.js");

    // Capture the transport callback
    let transportCallback: ((logObj: unknown) => void) | undefined;

    // Create logger to get the transport
    const logger = createLogger({
      logToFile: true,
      logDir: "/test/logs",
      name: "test-file",
    });

    // The mock attachTransport captures the callback
    const attachCall = (logger.attachTransport as ReturnType<typeof vi.fn>).mock.calls[0];
    if (attachCall && attachCall[0]) {
      transportCallback = attachCall[0];
    }

    // Manually call transport if it was captured
    if (transportCallback) {
      transportCallback({ msg: "test log message" });
      expect(fs.default.appendFileSync).toHaveBeenCalled();
    }

    expect(logger.attachTransport).toHaveBeenCalled();
  });
});

describe("createChildLogger", () => {
  it("should create a child logger", async () => {
    const { createLogger, createChildLogger } = await import("./logger.js");

    const parent = createLogger({ name: "parent" });
    const child = createChildLogger(parent, "child");

    expect(parent.getSubLogger).toHaveBeenCalledWith({ name: "child" });
    expect(child).toBeDefined();
  });
});

describe("getLogger", () => {
  beforeEach(async () => {
    // Reset global logger
    const { setLogger } = await import("./logger.js");
    setLogger(null as any);
  });

  it("should return the global logger instance", async () => {
    const { getLogger } = await import("./logger.js");

    const logger1 = getLogger();
    const logger2 = getLogger();

    // Should return same instance
    expect(logger1).toBe(logger2);
  });
});

describe("setLogger", () => {
  it("should set the global logger instance", async () => {
    const { getLogger, setLogger, createLogger } = await import("./logger.js");

    const customLogger = createLogger({ name: "custom" });
    setLogger(customLogger);

    const retrieved = getLogger();
    expect(retrieved).toBe(customLogger);
  });
});

describe("initializeLogging", () => {
  it("should initialize logging for a project", async () => {
    const { initializeLogging, getLogger, setLogger } = await import("./logger.js");
    setLogger(null as any);

    const logger = initializeLogging("/test/project", "debug");

    expect(logger).toBeDefined();
    expect(getLogger()).toBe(logger);
  });
});

describe("logEvent", () => {
  it("should log a structured event", async () => {
    const { createLogger, logEvent } = await import("./logger.js");

    const logger = createLogger();
    logEvent(logger, "test_event", { key: "value" });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "test_event",
        key: "value",
      })
    );
  });
});

describe("logTiming", () => {
  it("should log successful operation timing", async () => {
    const { createLogger, logTiming } = await import("./logger.js");

    const logger = createLogger();
    const result = await logTiming(logger, "test_op", async () => "success");

    expect(result).toBe("success");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "test_op",
        status: "success",
      })
    );
  });

  it("should log failed operation timing", async () => {
    const { createLogger, logTiming } = await import("./logger.js");

    const logger = createLogger();
    const error = new Error("Operation failed");

    await expect(
      logTiming(logger, "failing_op", async () => {
        throw error;
      })
    ).rejects.toThrow("Operation failed");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "failing_op",
        status: "error",
      })
    );
  });
});
