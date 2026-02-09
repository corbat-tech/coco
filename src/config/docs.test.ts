/**
 * Tests for schema documentation generator
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  generateSchemaDocs,
  generateDocs,
  formatDocsAsMarkdown,
  formatDocsAsPlainText,
} from "./docs.js";

describe("generateSchemaDocs", () => {
  it("should generate docs for simple object schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const docs = generateSchemaDocs(schema, "User Config");

    expect(docs.title).toBe("User Config");
    expect(docs.fields).toHaveLength(2);
    expect(docs.fields.find((f) => f.name === "name")?.type).toBe("string");
    expect(docs.fields.find((f) => f.name === "age")?.type).toBe("number");
  });

  it("should handle optional fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "required")?.required).toBe(true);
    expect(docs.fields.find((f) => f.name === "optional")?.required).toBe(false);
  });

  it("should handle default values", () => {
    const schema = z.object({
      withDefault: z.string().default("hello"),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "withDefault")?.default).toBe('"hello"');
    expect(docs.fields.find((f) => f.name === "withDefault")?.required).toBe(false);
  });

  it("should handle enum fields", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive", "pending"]),
    });

    const docs = generateSchemaDocs(schema, "Test");

    const statusField = docs.fields.find((f) => f.name === "status");
    expect(statusField?.type).toBe("enum");
    expect(statusField?.enum).toEqual(["active", "inactive", "pending"]);
  });

  it("should handle nested objects", () => {
    const schema = z.object({
      nested: z.object({
        inner: z.string(),
      }),
    });

    const docs = generateSchemaDocs(schema, "Test");

    const nestedField = docs.fields.find((f) => f.name === "nested");
    expect(nestedField?.type).toBe("object");
    expect(nestedField?.nested).toHaveLength(1);
    expect(nestedField?.nested?.[0].name).toBe("inner");
  });

  it("should handle arrays", () => {
    const schema = z.object({
      items: z.array(z.string()),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "items")?.type).toBe("string[]");
  });

  it("should respect maxDepth option", () => {
    const schema = z.object({
      level1: z.object({
        level2: z.object({
          level3: z.string(),
        }),
      }),
    });

    // With maxDepth: 1, we should see level1's nested (level2) but level2 should not have nested (level3)
    const docs = generateSchemaDocs(schema, "Test", { maxDepth: 1 });

    const level1 = docs.fields.find((f) => f.name === "level1");
    expect(level1?.nested).toBeDefined();
    const level2 = level1?.nested?.find((f) => f.name === "level2");
    expect(level2?.nested).toBeUndefined();
  });

  it("should hide defaults when showDefaults is false", () => {
    const schema = z.object({
      withDefault: z.string().default("hello"),
    });

    const docs = generateSchemaDocs(schema, "Test", { showDefaults: false });

    expect(docs.fields.find((f) => f.name === "withDefault")?.default).toBeUndefined();
  });

  it("should handle boolean fields", () => {
    const schema = z.object({
      enabled: z.boolean(),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "enabled")?.type).toBe("boolean");
  });

  it("should handle nullable fields", () => {
    const schema = z.object({
      nullable: z.string().nullable(),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "nullable")?.required).toBe(false);
  });

  it("should handle union types", () => {
    const schema = z.object({
      value: z.union([z.string(), z.number()]),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "value")?.type).toBe("string | number");
  });

  it("should handle record types", () => {
    const schema = z.object({
      data: z.record(z.string(), z.string()),
    });

    const docs = generateSchemaDocs(schema, "Test");

    expect(docs.fields.find((f) => f.name === "data")?.type).toBe("Record<string, string>");
  });
});

describe("formatDocsAsMarkdown", () => {
  it("should generate markdown with title", () => {
    const schema = z.object({
      field: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test Config");
    const markdown = formatDocsAsMarkdown(docs);

    expect(markdown).toContain("# Test Config");
  });

  it("should include field names in markdown", () => {
    const schema = z.object({
      myField: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const markdown = formatDocsAsMarkdown(docs);

    expect(markdown).toContain("myField");
  });

  it("should include types when showTypes is true", () => {
    const schema = z.object({
      field: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const markdown = formatDocsAsMarkdown(docs, { showTypes: true });

    expect(markdown).toContain("`string`");
  });

  it("should mark optional fields", () => {
    const schema = z.object({
      optional: z.string().optional(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const markdown = formatDocsAsMarkdown(docs);

    expect(markdown).toContain("optional");
  });

  it("should include default values", () => {
    const schema = z.object({
      field: z.string().default("default"),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const markdown = formatDocsAsMarkdown(docs);

    expect(markdown).toContain("Default:");
    expect(markdown).toContain('"default"');
  });

  it("should include enum values", () => {
    const schema = z.object({
      status: z.enum(["a", "b", "c"]),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const markdown = formatDocsAsMarkdown(docs);

    expect(markdown).toContain("Values:");
    expect(markdown).toContain("`a`");
  });
});

describe("formatDocsAsPlainText", () => {
  it("should generate plain text with title", () => {
    const schema = z.object({
      field: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test Config");
    const text = formatDocsAsPlainText(docs);

    expect(text).toContain("Test Config");
    expect(text).toContain("=");
  });

  it("should include field names", () => {
    const schema = z.object({
      myField: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const text = formatDocsAsPlainText(docs);

    expect(text).toContain("myField");
  });

  it("should include types when showTypes is true", () => {
    const schema = z.object({
      field: z.string(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const text = formatDocsAsPlainText(docs, { showTypes: true });

    expect(text).toContain("(string)");
  });

  it("should mark optional fields", () => {
    const schema = z.object({
      optional: z.string().optional(),
    });

    const docs = generateSchemaDocs(schema, "Test");
    const text = formatDocsAsPlainText(docs);

    expect(text).toContain("[optional]");
  });
});

describe("generateDocs", () => {
  it("should generate markdown by default", () => {
    const schema = z.object({
      field: z.string(),
    });

    const result = generateDocs(schema, "Test");

    expect(result).toContain("#");
  });

  it("should generate markdown when format is markdown", () => {
    const schema = z.object({
      field: z.string(),
    });

    const result = generateDocs(schema, "Test", { format: "markdown" });

    expect(result).toContain("#");
  });

  it("should generate plain text when format is plain", () => {
    const schema = z.object({
      field: z.string(),
    });

    const result = generateDocs(schema, "Test", { format: "plain" });

    expect(result).toContain("=");
    expect(result).not.toContain("#");
  });
});
