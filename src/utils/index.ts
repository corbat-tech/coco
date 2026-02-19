/**
 * Utility exports for Corbat-Coco
 */

// Logger
export {
  createLogger,
  createChildLogger,
  getLogger,
  setLogger,
  initializeLogging,
  logEvent,
  logTiming,
  type LogLevel,
  type LoggerConfig,
} from "./logger.js";

// Errors
export {
  CocoError,
  ConfigError,
  FileSystemError,
  ProviderError,
  ValidationError,
  PhaseError,
  TaskError,
  QualityError,
  RecoveryError,
  ToolError,
  TimeoutError,
  isCocoError,
  formatError,
  withErrorHandling,
  withRetry,
} from "./errors.js";

// Validation
export {
  validate,
  safeValidate,
  CommonSchemas,
  createIdGenerator,
  assertDefined,
  assert,
  coerce,
  validateFileExtension,
  isValidJson,
  parseJsonSafe,
} from "./validation.js";

// Async utilities
export { sleep, timeout, debounce, throttle, retry, parallel, sequential } from "./async.js";

// String utilities
export {
  truncate,
  slugify,
  capitalize,
  camelToKebab,
  kebabToCamel,
  indent,
  dedent,
  pluralize,
} from "./strings.js";

// File utilities
export {
  ensureDir,
  fileExists,
  readJsonFile,
  writeJsonFile,
  copyFile,
  removeFile,
  getFileHash,
} from "./files.js";

// Platform detection
export { isWSL } from "./platform.js";
