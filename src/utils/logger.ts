/**
 * Logging system for Corbat-Coco
 * Based on tslog with structured output
 */

import { Logger, ILogObj } from "tslog";
import fs from "node:fs";
import path from "node:path";

/**
 * Log levels
 */
export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Logger configuration
 */
export interface LoggerConfig {
  name: string;
  level: LogLevel;
  prettyPrint: boolean;
  logToFile: boolean;
  logDir?: string;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  name: "coco",
  level: "info",
  prettyPrint: true,
  logToFile: false,
};

/**
 * Map log level string to tslog minLevel number
 */
function levelToNumber(level: LogLevel): number {
  const levels: Record<LogLevel, number> = {
    silly: 0,
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
    fatal: 6,
  };
  return levels[level];
}

/**
 * Create a logger instance
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger<ILogObj> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  const logger = new Logger<ILogObj>({
    name: finalConfig.name,
    minLevel: levelToNumber(finalConfig.level),
    prettyLogTemplate: finalConfig.prettyPrint
      ? "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] "
      : undefined,
    prettyLogTimeZone: "local",
    stylePrettyLogs: finalConfig.prettyPrint,
  });

  // Add file transport if enabled
  if (finalConfig.logToFile && finalConfig.logDir) {
    setupFileLogging(logger, finalConfig.logDir, finalConfig.name);
  }

  return logger;
}

/**
 * Setup file logging
 */
function setupFileLogging(
  logger: Logger<ILogObj>,
  logDir: string,
  name: string
): void {
  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `${name}.log`);

  logger.attachTransport((logObj) => {
    const line = JSON.stringify(logObj) + "\n";
    fs.appendFileSync(logFile, line);
  });
}

/**
 * Create a child logger with a specific name
 */
export function createChildLogger(
  parent: Logger<ILogObj>,
  name: string
): Logger<ILogObj> {
  return parent.getSubLogger({ name });
}

/**
 * Global logger instance
 */
let globalLogger: Logger<ILogObj> | null = null;

/**
 * Get the global logger instance
 */
export function getLogger(): Logger<ILogObj> {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}

/**
 * Set the global logger instance
 */
export function setLogger(logger: Logger<ILogObj>): void {
  globalLogger = logger;
}

/**
 * Initialize logging for a project
 */
export function initializeLogging(projectPath: string, level: LogLevel = "info"): Logger<ILogObj> {
  const logDir = path.join(projectPath, ".coco", "logs");

  const logger = createLogger({
    name: "coco",
    level,
    prettyPrint: process.stdout.isTTY ?? true,
    logToFile: true,
    logDir,
  });

  setLogger(logger);
  return logger;
}

/**
 * Log a structured event (for analytics/debugging)
 */
export function logEvent(
  logger: Logger<ILogObj>,
  event: string,
  data: Record<string, unknown> = {}
): void {
  logger.info({ event, ...data });
}

/**
 * Log execution timing
 */
export async function logTiming<T>(
  logger: Logger<ILogObj>,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    logger.debug({ operation, durationMs: duration.toFixed(2), status: "success" });
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error({ operation, durationMs: duration.toFixed(2), status: "error", error });
    throw error;
  }
}
