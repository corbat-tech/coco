/**
 * Tests for database tools
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("database", () => {
  describe("isDangerousSql", () => {
    it("should detect DROP TABLE", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("DROP TABLE users")).toBe(true);
    });

    it("should detect DELETE FROM", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("DELETE FROM users WHERE id = 1")).toBe(true);
    });

    it("should detect TRUNCATE", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("TRUNCATE table_name")).toBe(true);
    });

    it("should detect INSERT INTO", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("INSERT INTO users VALUES (1, 'test')")).toBe(true);
    });

    it("should detect UPDATE SET", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("UPDATE users SET name = 'test'")).toBe(true);
    });

    it("should not flag SELECT queries", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("SELECT * FROM users")).toBe(false);
    });

    it("should not flag PRAGMA queries", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("PRAGMA table_info(users)")).toBe(false);
    });

    it("should be case insensitive", async () => {
      const { isDangerousSql } = await import("./database.js");
      expect(isDangerousSql("drop table users")).toBe(true);
      expect(isDangerousSql("Delete From users")).toBe(true);
    });
  });

  describe("sqlQueryTool", () => {
    it("should have correct metadata", async () => {
      const { sqlQueryTool } = await import("./database.js");
      expect(sqlQueryTool.name).toBe("sql_query");
      expect(sqlQueryTool.category).toBe("build");
    });

    it("should validate parameters", async () => {
      const { sqlQueryTool } = await import("./database.js");

      const valid = sqlQueryTool.parameters.safeParse({
        database: "data.db",
        query: "SELECT * FROM users",
      });
      expect(valid.success).toBe(true);

      const withParams = sqlQueryTool.parameters.safeParse({
        database: "data.db",
        query: "SELECT * FROM users WHERE id = ?",
        params: [1],
        readonly: true,
      });
      expect(withParams.success).toBe(true);
    });

    it("should block dangerous SQL in readonly mode", async () => {
      const { sqlQueryTool } = await import("./database.js");

      await expect(
        sqlQueryTool.execute({
          database: "data.db",
          query: "DROP TABLE users",
          params: [],
          readonly: true,
        }),
      ).rejects.toThrow("blocked in readonly mode");
    });
  });

  describe("inspectSchemaTool", () => {
    it("should have correct metadata", async () => {
      const { inspectSchemaTool } = await import("./database.js");
      expect(inspectSchemaTool.name).toBe("inspect_schema");
      expect(inspectSchemaTool.category).toBe("build");
    });

    it("should validate parameters", async () => {
      const { inspectSchemaTool } = await import("./database.js");

      const valid = inspectSchemaTool.parameters.safeParse({
        database: "data.db",
      });
      expect(valid.success).toBe(true);

      const withTable = inspectSchemaTool.parameters.safeParse({
        database: "data.db",
        table: "users",
      });
      expect(withTable.success).toBe(true);
    });
  });
});
