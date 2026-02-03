/**
 * Schema documentation generator for Corbat-Coco
 * Generates markdown documentation from Zod schemas
 */

import { z } from "zod";

/**
 * Field documentation
 */
export interface FieldDoc {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string;
  enum?: string[];
  nested?: FieldDoc[];
}

/**
 * Schema documentation
 */
export interface SchemaDoc {
  title: string;
  description?: string;
  fields: FieldDoc[];
}

/**
 * Documentation options
 */
export interface DocOptions {
  /** Include default values */
  showDefaults?: boolean;
  /** Include type annotations */
  showTypes?: boolean;
  /** Maximum depth for nested objects */
  maxDepth?: number;
  /** Format style */
  format?: "markdown" | "plain";
}

/**
 * Default documentation options
 */
const defaultOptions: Required<DocOptions> = {
  showDefaults: true,
  showTypes: true,
  maxDepth: 5,
  format: "markdown",
};

/**
 * Generate documentation from a Zod schema
 */
export function generateSchemaDocs(
  schema: z.ZodTypeAny,
  title: string,
  options: DocOptions = {}
): SchemaDoc {
  const opts = { ...defaultOptions, ...options };

  return {
    title,
    description: extractDescription(schema),
    fields: extractFields(schema, opts, 0),
  };
}

/**
 * Extract description from schema
 */
function extractDescription(schema: z.ZodTypeAny): string | undefined {
  // Check for description in _def
  const def = schema._def;
  if (def.description) {
    return def.description;
  }
  return undefined;
}

/**
 * Extract fields from schema
 */
function extractFields(
  schema: z.ZodTypeAny,
  options: Required<DocOptions>,
  depth: number
): FieldDoc[] {
  if (depth >= options.maxDepth) {
    return [];
  }

  const def = schema._def;

  // Handle different schema types
  switch (def.typeName) {
    case "ZodObject":
      return extractObjectFields(schema as z.ZodObject<z.ZodRawShape>, options, depth);

    case "ZodOptional":
    case "ZodNullable":
      return extractFields(def.innerType, options, depth);

    case "ZodDefault":
      return extractFields(def.innerType, options, depth);

    case "ZodEffects":
      return extractFields(def.schema, options, depth);

    default:
      return [];
  }
}

/**
 * Extract fields from an object schema
 */
function extractObjectFields(
  schema: z.ZodObject<z.ZodRawShape>,
  options: Required<DocOptions>,
  depth: number
): FieldDoc[] {
  const shape = schema.shape;
  const fields: FieldDoc[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const fieldSchema = value as z.ZodTypeAny;
    const field = extractFieldInfo(key, fieldSchema, options, depth);
    fields.push(field);
  }

  return fields;
}

/**
 * Extract information about a single field
 */
function extractFieldInfo(
  name: string,
  schema: z.ZodTypeAny,
  options: Required<DocOptions>,
  depth: number
): FieldDoc {
  let innerSchema = schema;
  let isOptional = false;
  let defaultValue: string | undefined;

  // Unwrap optional/nullable/default
  while (true) {
    const innerDef = innerSchema._def;

    if (innerDef.typeName === "ZodOptional") {
      isOptional = true;
      innerSchema = innerDef.innerType;
    } else if (innerDef.typeName === "ZodNullable") {
      isOptional = true;
      innerSchema = innerDef.innerType;
    } else if (innerDef.typeName === "ZodDefault") {
      isOptional = true;
      defaultValue = formatDefaultValue(innerDef.defaultValue());
      innerSchema = innerDef.innerType;
    } else {
      break;
    }
  }

  const type = getTypeName(innerSchema);
  const description = extractDescription(schema) ?? extractDescription(innerSchema) ?? "";
  const enumValues = getEnumValues(innerSchema);

  // Extract nested fields for objects
  let nested: FieldDoc[] | undefined;
  if (innerSchema._def.typeName === "ZodObject" && depth < options.maxDepth) {
    nested = extractObjectFields(
      innerSchema as z.ZodObject<z.ZodRawShape>,
      options,
      depth + 1
    );
  }

  return {
    name,
    type,
    description,
    required: !isOptional,
    default: options.showDefaults ? defaultValue : undefined,
    enum: enumValues,
    nested,
  };
}

/**
 * Get type name for a schema
 */
function getTypeName(schema: z.ZodTypeAny): string {
  const def = schema._def;

  switch (def.typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      const itemType = getTypeName(def.type);
      return `${itemType}[]`;
    case "ZodObject":
      return "object";
    case "ZodEnum":
      return "enum";
    case "ZodLiteral":
      return `"${def.value}"`;
    case "ZodUnion":
      const unionTypes = def.options.map((opt: z.ZodTypeAny) => getTypeName(opt));
      return unionTypes.join(" | ");
    case "ZodRecord":
      const valueType = getTypeName(def.valueType);
      return `Record<string, ${valueType}>`;
    case "ZodTuple":
      const tupleTypes = def.items.map((item: z.ZodTypeAny) => getTypeName(item));
      return `[${tupleTypes.join(", ")}]`;
    case "ZodNativeEnum":
      return "enum";
    case "ZodAny":
      return "any";
    case "ZodUnknown":
      return "unknown";
    case "ZodNull":
      return "null";
    case "ZodUndefined":
      return "undefined";
    case "ZodVoid":
      return "void";
    case "ZodNever":
      return "never";
    case "ZodDate":
      return "Date";
    case "ZodBigInt":
      return "bigint";
    case "ZodSymbol":
      return "symbol";
    default:
      return "unknown";
  }
}

/**
 * Get enum values if applicable
 */
function getEnumValues(schema: z.ZodTypeAny): string[] | undefined {
  const def = schema._def;

  if (def.typeName === "ZodEnum") {
    return def.values;
  }

  if (def.typeName === "ZodNativeEnum") {
    return Object.values(def.values).filter((v): v is string => typeof v === "string");
  }

  return undefined;
}

/**
 * Format default value for display
 */
function formatDefaultValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Format schema documentation as markdown
 */
export function formatDocsAsMarkdown(doc: SchemaDoc, options: DocOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  const lines: string[] = [];

  // Title
  lines.push(`# ${doc.title}`);
  lines.push("");

  // Description
  if (doc.description) {
    lines.push(doc.description);
    lines.push("");
  }

  // Fields table
  lines.push("## Configuration Options");
  lines.push("");

  if (doc.fields.length > 0) {
    lines.push(formatFieldsAsMarkdown(doc.fields, opts, 0));
  } else {
    lines.push("No configuration options.");
  }

  return lines.join("\n");
}

/**
 * Format fields as markdown
 */
function formatFieldsAsMarkdown(
  fields: FieldDoc[],
  options: Required<DocOptions>,
  depth: number
): string {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  for (const field of fields) {
    // Field name and type
    let line = `${indent}- **${field.name}**`;
    if (options.showTypes) {
      line += ` \`${field.type}\``;
    }
    if (!field.required) {
      line += " *(optional)*";
    }
    lines.push(line);

    // Description
    if (field.description) {
      lines.push(`${indent}  ${field.description}`);
    }

    // Enum values
    if (field.enum && field.enum.length > 0) {
      lines.push(`${indent}  Values: ${field.enum.map(v => `\`${v}\``).join(", ")}`);
    }

    // Default value
    if (field.default !== undefined) {
      lines.push(`${indent}  Default: \`${field.default}\``);
    }

    // Nested fields
    if (field.nested && field.nested.length > 0) {
      lines.push("");
      lines.push(formatFieldsAsMarkdown(field.nested, options, depth + 1));
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format schema documentation as plain text
 */
export function formatDocsAsPlainText(doc: SchemaDoc, options: DocOptions = {}): string {
  const opts = { ...defaultOptions, ...options };
  const lines: string[] = [];

  // Title
  lines.push(doc.title);
  lines.push("=".repeat(doc.title.length));
  lines.push("");

  // Description
  if (doc.description) {
    lines.push(doc.description);
    lines.push("");
  }

  // Fields
  lines.push("Configuration Options:");
  lines.push("-".repeat(22));
  lines.push("");

  if (doc.fields.length > 0) {
    lines.push(formatFieldsAsPlainText(doc.fields, opts, 0));
  } else {
    lines.push("No configuration options.");
  }

  return lines.join("\n");
}

/**
 * Format fields as plain text
 */
function formatFieldsAsPlainText(
  fields: FieldDoc[],
  options: Required<DocOptions>,
  depth: number
): string {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  for (const field of fields) {
    // Field name
    let line = `${indent}${field.name}`;
    if (options.showTypes) {
      line += ` (${field.type})`;
    }
    if (!field.required) {
      line += " [optional]";
    }
    lines.push(line);

    // Description
    if (field.description) {
      lines.push(`${indent}  ${field.description}`);
    }

    // Enum values
    if (field.enum && field.enum.length > 0) {
      lines.push(`${indent}  Values: ${field.enum.join(", ")}`);
    }

    // Default value
    if (field.default !== undefined) {
      lines.push(`${indent}  Default: ${field.default}`);
    }

    // Nested fields
    if (field.nested && field.nested.length > 0) {
      lines.push(formatFieldsAsPlainText(field.nested, options, depth + 1));
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate documentation for a schema in the specified format
 */
export function generateDocs(
  schema: z.ZodTypeAny,
  title: string,
  options: DocOptions = {}
): string {
  const doc = generateSchemaDocs(schema, title, options);
  const format = options.format ?? "markdown";

  switch (format) {
    case "markdown":
      return formatDocsAsMarkdown(doc, options);
    case "plain":
      return formatDocsAsPlainText(doc, options);
    default:
      return formatDocsAsMarkdown(doc, options);
  }
}
