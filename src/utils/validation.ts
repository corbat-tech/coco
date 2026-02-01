/**
 * Validation utilities for Corbat-Coco
 */

import { z } from "zod";
import { ValidationError, type ValidationIssue } from "./errors.js";

/**
 * Validate data against a Zod schema
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));

  throw new ValidationError(
    context
      ? `Validation failed for ${context}`
      : "Validation failed",
    { issues }
  );
}

/**
 * Safe validate (returns result instead of throwing)
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; issues: ValidationIssue[] } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));

  return { success: false, issues };
}

/**
 * Common validation schemas
 */
export const CommonSchemas = {
  /**
   * Non-empty string
   */
  nonEmptyString: z.string().min(1, "Cannot be empty"),

  /**
   * Slug (lowercase letters, numbers, hyphens)
   */
  slug: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must be lowercase letters, numbers, and hyphens"
  ),

  /**
   * Semantic version
   */
  semver: z.string().regex(
    /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/,
    "Must be a valid semantic version (e.g., 1.0.0)"
  ),

  /**
   * File path
   */
  filePath: z.string().min(1, "Path cannot be empty"),

  /**
   * Positive integer
   */
  positiveInt: z.number().int().positive(),

  /**
   * Percentage (0-100)
   */
  percentage: z.number().min(0).max(100),

  /**
   * URL
   */
  url: z.string().url(),

  /**
   * Email
   */
  email: z.string().email(),

  /**
   * UUID
   */
  uuid: z.string().uuid(),

  /**
   * ISO date string
   */
  isoDate: z.string().datetime(),
};

/**
 * Create a validated ID generator
 */
export function createIdGenerator(prefix: string): () => string {
  return () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  };
}

/**
 * Validate that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string = "Value is not defined"
): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(message);
  }
}

/**
 * Validate that a condition is true
 */
export function assert(
  condition: boolean,
  message: string = "Assertion failed"
): asserts condition {
  if (!condition) {
    throw new ValidationError(message);
  }
}

/**
 * Coerce a value to a specific type, with fallback
 */
export function coerce<T>(
  value: unknown,
  schema: z.ZodSchema<T>,
  fallback: T
): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/**
 * Validate file extension
 */
export function validateFileExtension(
  filename: string,
  allowedExtensions: string[]
): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext !== undefined && allowedExtensions.includes(ext);
}

/**
 * Validate JSON string
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse JSON safely
 */
export function parseJsonSafe<T>(
  str: string,
  schema?: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(str);
    if (schema) {
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return { success: true, data: validated.data };
      }
      return {
        success: false,
        error: validated.error.issues.map((i) => i.message).join(", "),
      };
    }
    return { success: true, data: parsed as T };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}
