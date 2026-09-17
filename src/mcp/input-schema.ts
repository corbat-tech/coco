/** Compile remote contracts without a lossy JSON Schema → Zod → JSON Schema round trip. */
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { z } from "zod";

const DRAFT7 = "http://json-schema.org/draft-07/schema";
const DRAFT2020 = "https://json-schema.org/draft/2020-12/schema";

function assertLocalReferences(schema: unknown, depth = 0): void {
  if (depth > 64) throw new Error("MCP input schema exceeds nesting limit (64)");
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const value = schema as Record<string, unknown>;
  if ("$async" in value) throw new Error("Asynchronous MCP input schemas are unsupported");
  for (const key of ["$ref", "$dynamicRef", "$recursiveRef"]) {
    if (key in value && (typeof value[key] !== "string" || !value[key].startsWith("#"))) {
      throw new Error("MCP input schema supports only local references");
    }
  }
  for (const key of [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
  ]) {
    if (value[key] && typeof value[key] === "object") {
      for (const child of Object.values(value[key])) assertLocalReferences(child, depth + 1);
    }
  }
  for (const key of [
    "items",
    "prefixItems",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "additionalProperties",
    "additionalItems",
    "contains",
    "propertyNames",
    "unevaluatedProperties",
    "unevaluatedItems",
    "dependencies",
  ]) {
    const child = value[key];
    if (Array.isArray(child)) child.forEach((item) => assertLocalReferences(item, depth + 1));
    else if (key === "dependencies" && child && typeof child === "object") {
      Object.values(child).forEach((item) => assertLocalReferences(item, depth + 1));
    } else assertLocalReferences(child, depth + 1);
  }
}

export function compileMCPInputSchema(schema: Record<string, unknown>): z.ZodType {
  if (schema.type !== "object") throw new Error("MCP tool input must be an object schema");
  assertLocalReferences(schema);
  const dialect = typeof schema.$schema === "string" ? schema.$schema.replace(/#$/, "") : DRAFT2020;
  if (dialect !== DRAFT7 && dialect !== DRAFT2020) {
    throw new Error(`Unsupported MCP JSON Schema dialect: ${dialect}`);
  }
  // A fresh compiler isolates remote $id namespaces and avoids caching disconnected servers.
  const Constructor = dialect === DRAFT7 ? Ajv : Ajv2020;
  const ajv = new Constructor({
    strictSchema: true,
    strictTypes: false,
    strictTuples: false,
    strictRequired: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    ownProperties: true,
    allErrors: false,
  });
  for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
  const validate = ajv.compile(schema);
  return z.unknown().superRefine((value, context) => {
    if (!validate(value)) {
      context.addIssue({ code: "custom", message: ajv.errorsText(validate.errors) });
    }
  });
}
