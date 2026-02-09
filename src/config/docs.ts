/**
 * Schema documentation generator for Corbat-Coco
 * Generates markdown documentation from Zod schemas
 *
 * Compatible with Zod 4 using instanceof checks instead of _def.typeName
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
  options: DocOptions = {},
): SchemaDoc {
  const opts = { ...defaultOptions, ...options };

  return {
    title,
    description: extractDescription(schema),
    fields: extractFields(schema, opts, 0),
  };
}

/**
 * Extract description from schema.
 * In Zod 4, description is directly on the schema object.
 */
function extractDescription(schema: z.ZodTypeAny): string | undefined {
  return schema.description ?? undefined;
}

/**
 * Extract fields from schema using instanceof checks (Zod 4 compatible)
 */
function extractFields(
  schema: z.ZodTypeAny,
  options: Required<DocOptions>,
  depth: number,
): FieldDoc[] {
  if (depth >= options.maxDepth) {
    return [];
  }

  if (schema instanceof z.ZodObject) {
    return extractObjectFields(schema as z.ZodObject<z.ZodRawShape>, options, depth);
  }

  if (schema instanceof z.ZodOptional) {
    return extractFields((schema as z.ZodOptional<z.ZodTypeAny>).unwrap(), options, depth);
  }

  if (schema instanceof z.ZodNullable) {
    return extractFields((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), options, depth);
  }

  if (schema instanceof z.ZodDefault) {
    return extractFields((schema as z.ZodDefault<z.ZodTypeAny>).removeDefault(), options, depth);
  }

  // ZodEffects is replaced by ZodPipe in Zod 4 (e.g. from .transform())
  if (schema instanceof z.ZodPipe) {
    const pipeDef = (schema as any)._zod.def;
    return extractFields(pipeDef.in, options, depth);
  }

  return [];
}

/**
 * Extract fields from an object schema
 */
function extractObjectFields(
  schema: z.ZodObject<z.ZodRawShape>,
  options: Required<DocOptions>,
  depth: number,
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
 * Extract information about a single field using instanceof checks (Zod 4 compatible)
 */
function extractFieldInfo(
  name: string,
  schema: z.ZodTypeAny,
  options: Required<DocOptions>,
  depth: number,
): FieldDoc {
  let innerSchema = schema;
  let isOptional = false;
  let defaultValue: string | undefined;

  // Unwrap optional/nullable/default using instanceof checks
  while (true) {
    if (innerSchema instanceof z.ZodOptional) {
      isOptional = true;
      innerSchema = (innerSchema as z.ZodOptional<z.ZodTypeAny>).unwrap();
    } else if (innerSchema instanceof z.ZodNullable) {
      isOptional = true;
      innerSchema = (innerSchema as z.ZodNullable<z.ZodTypeAny>).unwrap();
    } else if (innerSchema instanceof z.ZodDefault) {
      isOptional = true;
      // In Zod 4, defaultValue is a direct value on _zod.def (not a function)
      const defValue = (innerSchema as any)._zod.def.defaultValue;
      defaultValue = formatDefaultValue(defValue);
      innerSchema = (innerSchema as z.ZodDefault<z.ZodTypeAny>).removeDefault();
    } else {
      break;
    }
  }

  const type = getTypeName(innerSchema);
  const description = extractDescription(schema) ?? extractDescription(innerSchema) ?? "";
  const enumValues = getEnumValues(innerSchema);

  // Extract nested fields for objects
  let nested: FieldDoc[] | undefined;
  if (innerSchema instanceof z.ZodObject && depth < options.maxDepth) {
    nested = extractObjectFields(innerSchema as z.ZodObject<z.ZodRawShape>, options, depth + 1);
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
 * Get type name for a schema using instanceof checks (Zod 4 compatible)
 */
function getTypeName(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) {
    return "string";
  }
  if (schema instanceof z.ZodNumber) {
    return "number";
  }
  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }
  if (schema instanceof z.ZodArray) {
    const itemType = getTypeName((schema as z.ZodArray<z.ZodTypeAny>).element);
    return `${itemType}[]`;
  }
  if (schema instanceof z.ZodObject) {
    return "object";
  }
  if (schema instanceof z.ZodEnum) {
    return "enum";
  }
  if (schema instanceof z.ZodLiteral) {
    return `"${(schema as z.ZodLiteral<any>).value}"`;
  }
  if (schema instanceof z.ZodUnion) {
    const unionOptions = (schema as z.ZodUnion<any>).options as z.ZodTypeAny[];
    const unionTypes = unionOptions.map((opt: z.ZodTypeAny) => getTypeName(opt));
    return unionTypes.join(" | ");
  }
  if (schema instanceof z.ZodRecord) {
    // In Zod 4: single-arg z.record(valueSchema) stores schema in _zod.def.keyType
    // Two-arg z.record(keySchema, valueSchema) stores value in _zod.def.valueType
    const recordDef = (schema as any)._zod.def;
    const valueSchema = recordDef.valueType || recordDef.keyType;
    const valueType = getTypeName(valueSchema);
    return `Record<string, ${valueType}>`;
  }
  if (schema instanceof z.ZodTuple) {
    // In Zod 4, tuple items are on _zod.def.items
    const tupleItems: z.ZodTypeAny[] = (schema as any)._zod.def.items;
    const tupleTypes = tupleItems.map((item: z.ZodTypeAny) => getTypeName(item));
    return `[${tupleTypes.join(", ")}]`;
  }
  if (schema instanceof z.ZodAny) {
    return "any";
  }
  if (schema instanceof z.ZodUnknown) {
    return "unknown";
  }
  if (schema instanceof z.ZodNull) {
    return "null";
  }
  if (schema instanceof z.ZodUndefined) {
    return "undefined";
  }
  if (schema instanceof z.ZodVoid) {
    return "void";
  }
  if (schema instanceof z.ZodNever) {
    return "never";
  }
  if (schema instanceof z.ZodDate) {
    return "Date";
  }
  if (schema instanceof z.ZodBigInt) {
    return "bigint";
  }
  if (schema instanceof z.ZodSymbol) {
    return "symbol";
  }

  return "unknown";
}

/**
 * Get enum values if applicable using instanceof checks (Zod 4 compatible)
 */
function getEnumValues(schema: z.ZodTypeAny): string[] | undefined {
  if (schema instanceof z.ZodEnum) {
    return (schema as z.ZodEnum<any>).options as string[];
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
  depth: number,
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
      lines.push(`${indent}  Values: ${field.enum.map((v) => `\`${v}\``).join(", ")}`);
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
  depth: number,
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
  options: DocOptions = {},
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
