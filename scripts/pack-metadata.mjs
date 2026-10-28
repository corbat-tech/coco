import { readFile } from "node:fs/promises";

/** Read one npm 12 package-name-keyed artifact or one npm <=11 array entry. */
export async function readPackMetadata(filename) {
  const value = JSON.parse(await readFile(filename, "utf8"));
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  const packed = entries.length === 1 ? entries[0] : undefined;
  if (
    !packed ||
    Array.isArray(packed) ||
    !["name", "version", "filename", "integrity"].every(
      (key) => typeof packed[key] === "string" && packed[key].length > 0,
    )
  ) {
    throw new Error("Expected metadata for exactly one packed npm artifact");
  }
  return packed;
}

/** npm 12 wraps scalar/object view results; npm <=11 returns them directly. */
export function parseRegistryResult(text) {
  const value = JSON.parse(text);
  if (!Array.isArray(value)) return value;
  if (value.length !== 1) throw new Error("Expected exactly one npm registry result");
  return value[0];
}
