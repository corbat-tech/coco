/**
 * Database tools for Corbat-Coco
 * SQLite query execution and schema inspection
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const path = await import("node:path");

/**
 * Dangerous SQL patterns (blocked in readonly mode)
 */
const DANGEROUS_PATTERNS = [
  /\bDROP\s+(?:TABLE|DATABASE|INDEX|VIEW)\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bCREATE\s+(?:TABLE|DATABASE|INDEX)\b/i,
];

/**
 * SQL query output
 */
export interface SqlQueryOutput {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  duration: number;
  readonly: boolean;
}

/**
 * Schema inspection output
 */
export interface SchemaInspectOutput {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primaryKey: boolean;
      defaultValue: string | null;
    }>;
    rowCount: number;
  }>;
  duration: number;
}

/**
 * Check if SQL is dangerous (write operation)
 */
export function isDangerousSql(sql: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(sql));
}

/**
 * SQL query tool
 */
export const sqlQueryTool: ToolDefinition<
  {
    database: string;
    query: string;
    params?: unknown[];
    readonly?: boolean;
  },
  SqlQueryOutput
> = defineTool({
  name: "sql_query",
  description: `Execute a SQL query against a SQLite database file. Default is readonly mode for safety.

Examples:
- Select query: { "database": "data.db", "query": "SELECT * FROM users LIMIT 10" }
- With params: { "database": "app.db", "query": "SELECT * FROM users WHERE id = ?", "params": [1] }
- Write mode: { "database": "data.db", "query": "INSERT INTO logs VALUES (?)", "params": ["test"], "readonly": false }`,
  category: "build",
  parameters: z.object({
    database: z.string().min(1).describe("Path to SQLite database file"),
    query: z.string().min(1).describe("SQL query to execute"),
    params: z
      .array(z.unknown())
      .optional()
      .default([])
      .describe("Query parameters (for parameterized queries)"),
    readonly: z
      .boolean()
      .optional()
      .default(true)
      .describe("Open database in readonly mode (default: true)"),
  }),
  async execute({ database, query, params, readonly: isReadonlyParam }) {
    const isReadonly = isReadonlyParam ?? true;
    const startTime = performance.now();
    const absPath = path.resolve(database);

    // Safety check in readonly mode
    if (isReadonly && isDangerousSql(query)) {
      throw new ToolError(
        "Write operations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE) are blocked in readonly mode. Set readonly: false to allow writes.",
        { tool: "sql_query" },
      );
    }

    try {
      // Dynamic import of better-sqlite3
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: Database } = await import("better-sqlite3");

      const db = new Database(absPath, {
        readonly: isReadonly,
        fileMustExist: true,
      });

      try {
        const stmt = db.prepare(query);

        let rows: Record<string, unknown>[];
        let columns: string[] = [];

        if (
          query.trim().toUpperCase().startsWith("SELECT") ||
          query.trim().toUpperCase().startsWith("PRAGMA") ||
          query.trim().toUpperCase().startsWith("WITH")
        ) {
          // Read query
          rows = stmt.all(...(params ?? [])) as Record<string, unknown>[];
          if (rows.length > 0 && rows[0]) {
            columns = Object.keys(rows[0]);
          }
        } else {
          // Write query
          const result = stmt.run(...(params ?? []));
          rows = [
            {
              changes: result.changes,
              lastInsertRowid: Number(result.lastInsertRowid),
            },
          ];
          columns = ["changes", "lastInsertRowid"];
        }

        // Limit rows to prevent massive output
        const maxRows = 1000;
        const limitedRows = rows.slice(0, maxRows);

        return {
          rows: limitedRows,
          columns,
          rowCount: rows.length,
          duration: performance.now() - startTime,
          readonly: isReadonly,
        };
      } finally {
        db.close();
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;

      if (
        (error as Error).message?.includes("Cannot find module") ||
        (error as Error).message?.includes("MODULE_NOT_FOUND")
      ) {
        throw new ToolError(
          "better-sqlite3 package is not installed. Run: pnpm add better-sqlite3",
          { tool: "sql_query" },
        );
      }

      throw new ToolError(
        `SQL query failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "sql_query", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * Schema inspection tool
 */
export const inspectSchemaTool: ToolDefinition<
  {
    database: string;
    table?: string;
  },
  SchemaInspectOutput
> = defineTool({
  name: "inspect_schema",
  description: `Inspect the schema of a SQLite database, showing tables, columns, and types.

Examples:
- Full schema: { "database": "data.db" }
- Specific table: { "database": "data.db", "table": "users" }`,
  category: "build",
  parameters: z.object({
    database: z.string().min(1).describe("Path to SQLite database file"),
    table: z
      .string()
      .optional()
      .describe("Specific table to inspect"),
  }),
  async execute({ database, table }) {
    const startTime = performance.now();
    const absPath = path.resolve(database);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(absPath, { readonly: true, fileMustExist: true });

      try {
        // Get table list
        let tableNames: string[];
        if (table) {
          tableNames = [table];
        } else {
          const tables = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as Array<{ name: string }>;
          tableNames = tables.map((t) => t.name);
        }

        const result: SchemaInspectOutput["tables"] = [];

        for (const tableName of tableNames) {
          // Get column info
          const columns = db
            .prepare(`PRAGMA table_info("${tableName}")`)
            .all() as Array<{
            name: string;
            type: string;
            notnull: number;
            pk: number;
            dflt_value: string | null;
          }>;

          // Get row count
          const countResult = db
            .prepare(`SELECT COUNT(*) as count FROM "${tableName}"`)
            .get() as { count: number };

          result.push({
            name: tableName,
            columns: columns.map((col) => ({
              name: col.name,
              type: col.type,
              nullable: col.notnull === 0,
              primaryKey: col.pk > 0,
              defaultValue: col.dflt_value,
            })),
            rowCount: countResult.count,
          });
        }

        return {
          tables: result,
          duration: performance.now() - startTime,
        };
      } finally {
        db.close();
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;

      if (
        (error as Error).message?.includes("Cannot find module") ||
        (error as Error).message?.includes("MODULE_NOT_FOUND")
      ) {
        throw new ToolError(
          "better-sqlite3 package is not installed. Run: pnpm add better-sqlite3",
          { tool: "inspect_schema" },
        );
      }

      throw new ToolError(
        `Schema inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        { tool: "inspect_schema", cause: error instanceof Error ? error : undefined },
      );
    }
  },
});

/**
 * All database tools
 */
export const databaseTools = [sqlQueryTool, inspectSchemaTool];
