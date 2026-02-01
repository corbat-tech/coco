/**
 * Tests for validation utilities
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("validate", () => {
  it("should validate data against schema", async () => {
    const { validate } = await import("./validation.js");

    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = validate(schema, { name: "John", age: 30 });

    expect(result).toEqual({ name: "John", age: 30 });
  });

  it("should throw ValidationError for invalid data", async () => {
    const { validate } = await import("./validation.js");

    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    expect(() => validate(schema, { name: "John", age: "thirty" })).toThrow();
  });

  it("should include context in error message", async () => {
    const { validate } = await import("./validation.js");

    const schema = z.object({ name: z.string() });

    expect(() => validate(schema, { name: 123 }, "User data")).toThrow(
      /User data/
    );
  });
});

describe("safeValidate", () => {
  it("should return success result for valid data", async () => {
    const { safeValidate } = await import("./validation.js");

    const schema = z.object({ name: z.string() });
    const result = safeValidate(schema, { name: "John" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "John" });
    }
  });

  it("should return failure result for invalid data", async () => {
    const { safeValidate } = await import("./validation.js");

    const schema = z.object({ name: z.string() });
    const result = safeValidate(schema, { name: 123 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("CommonSchemas", () => {
  it("should validate non-empty string", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.nonEmptyString.safeParse("hello").success).toBe(true);
    expect(CommonSchemas.nonEmptyString.safeParse("").success).toBe(false);
  });

  it("should validate slug format", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.slug.safeParse("my-project").success).toBe(true);
    expect(CommonSchemas.slug.safeParse("my_project").success).toBe(false);
    expect(CommonSchemas.slug.safeParse("MyProject").success).toBe(false);
  });

  it("should validate semver format", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.semver.safeParse("1.0.0").success).toBe(true);
    expect(CommonSchemas.semver.safeParse("1.0.0-beta.1").success).toBe(true);
    expect(CommonSchemas.semver.safeParse("1.0").success).toBe(false);
  });

  it("should validate percentage", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.percentage.safeParse(50).success).toBe(true);
    expect(CommonSchemas.percentage.safeParse(0).success).toBe(true);
    expect(CommonSchemas.percentage.safeParse(100).success).toBe(true);
    expect(CommonSchemas.percentage.safeParse(150).success).toBe(false);
    expect(CommonSchemas.percentage.safeParse(-10).success).toBe(false);
  });

  it("should validate URL", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.url.safeParse("https://example.com").success).toBe(true);
    expect(CommonSchemas.url.safeParse("not-a-url").success).toBe(false);
  });

  it("should validate email", async () => {
    const { CommonSchemas } = await import("./validation.js");

    expect(CommonSchemas.email.safeParse("user@example.com").success).toBe(true);
    expect(CommonSchemas.email.safeParse("not-an-email").success).toBe(false);
  });
});

describe("createIdGenerator", () => {
  it("should create IDs with the specified prefix", async () => {
    const { createIdGenerator } = await import("./validation.js");

    const generateId = createIdGenerator("test");
    const id = generateId();

    expect(id.startsWith("test_")).toBe(true);
  });

  it("should create unique IDs", async () => {
    const { createIdGenerator } = await import("./validation.js");

    const generateId = createIdGenerator("test");
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
  });
});

describe("assertDefined", () => {
  it("should not throw for defined values", async () => {
    const { assertDefined } = await import("./validation.js");

    expect(() => assertDefined("value")).not.toThrow();
    expect(() => assertDefined(0)).not.toThrow();
    expect(() => assertDefined(false)).not.toThrow();
    expect(() => assertDefined({})).not.toThrow();
  });

  it("should throw for null", async () => {
    const { assertDefined } = await import("./validation.js");

    expect(() => assertDefined(null)).toThrow();
  });

  it("should throw for undefined", async () => {
    const { assertDefined } = await import("./validation.js");

    expect(() => assertDefined(undefined)).toThrow();
  });

  it("should include custom message", async () => {
    const { assertDefined } = await import("./validation.js");

    expect(() => assertDefined(null, "Value must be defined")).toThrow(
      "Value must be defined"
    );
  });
});

describe("assert", () => {
  it("should not throw for true condition", async () => {
    const { assert } = await import("./validation.js");

    expect(() => assert(true)).not.toThrow();
    expect(() => assert(1 === 1)).not.toThrow();
  });

  it("should throw for false condition", async () => {
    const { assert } = await import("./validation.js");

    expect(() => assert(false)).toThrow();
    expect(() => assert(1 === 2)).toThrow();
  });
});

describe("coerce", () => {
  it("should return value if valid", async () => {
    const { coerce } = await import("./validation.js");

    const result = coerce("hello", z.string(), "default");

    expect(result).toBe("hello");
  });

  it("should return fallback if invalid", async () => {
    const { coerce } = await import("./validation.js");

    const result = coerce(123, z.string(), "default");

    expect(result).toBe("default");
  });
});

describe("validateFileExtension", () => {
  it("should return true for allowed extension", async () => {
    const { validateFileExtension } = await import("./validation.js");

    expect(validateFileExtension("file.ts", ["ts", "js"])).toBe(true);
    expect(validateFileExtension("file.js", ["ts", "js"])).toBe(true);
  });

  it("should return false for disallowed extension", async () => {
    const { validateFileExtension } = await import("./validation.js");

    expect(validateFileExtension("file.py", ["ts", "js"])).toBe(false);
  });

  it("should be case insensitive", async () => {
    const { validateFileExtension } = await import("./validation.js");

    expect(validateFileExtension("file.TS", ["ts"])).toBe(true);
  });
});

describe("isValidJson", () => {
  it("should return true for valid JSON", async () => {
    const { isValidJson } = await import("./validation.js");

    expect(isValidJson('{"name": "John"}')).toBe(true);
    expect(isValidJson("[]")).toBe(true);
    expect(isValidJson('"string"')).toBe(true);
  });

  it("should return false for invalid JSON", async () => {
    const { isValidJson } = await import("./validation.js");

    expect(isValidJson("{name: John}")).toBe(false);
    expect(isValidJson("not json")).toBe(false);
  });
});

describe("parseJsonSafe", () => {
  it("should parse valid JSON", async () => {
    const { parseJsonSafe } = await import("./validation.js");

    const result = parseJsonSafe('{"name": "John"}');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "John" });
    }
  });

  it("should validate against schema if provided", async () => {
    const { parseJsonSafe } = await import("./validation.js");

    const schema = z.object({ name: z.string() });
    const result = parseJsonSafe('{"name": "John"}', schema);

    expect(result.success).toBe(true);
  });

  it("should return error for schema validation failure", async () => {
    const { parseJsonSafe } = await import("./validation.js");

    const schema = z.object({ name: z.string() });
    const result = parseJsonSafe('{"name": 123}', schema);

    expect(result.success).toBe(false);
  });

  it("should return error for invalid JSON", async () => {
    const { parseJsonSafe } = await import("./validation.js");

    const result = parseJsonSafe("not json");

    expect(result.success).toBe(false);
  });
});
