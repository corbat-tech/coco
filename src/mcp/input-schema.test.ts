import { describe, expect, it, vi } from "vitest";
import { compileMCPInputSchema } from "./input-schema.js";
import { wrapMCPTools, wrapMCPTool } from "./tools.js";
import { ToolRegistry } from "../tools/registry.js";
import type { MCPClient, MCPTool } from "./types.js";

const client = { callTool: vi.fn().mockResolvedValue({ content: [] }) } as unknown as MCPClient;

describe("authoritative MCP input contracts", () => {
  it.each([
    undefined,
    "http://json-schema.org/draft-07/schema#",
    "https://json-schema.org/draft/2020-12/schema",
  ])("validates references and constraints with dialect %s", ($schema) => {
    const schema = {
      ...($schema ? { $schema } : {}),
      type: "object",
      definitions: { id: { type: "integer", minimum: 2 } },
      properties: {
        id: { $ref: "#/definitions/id" },
        names: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", minLength: 2 },
        },
        optional: { type: ["string", "number", "null"] },
      },
      required: ["id", "names"],
      additionalProperties: false,
    };
    const validator = compileMCPInputSchema(schema);
    expect(validator.parse({ id: 2, names: ["ok"], optional: 4 })).toEqual({
      id: 2,
      names: ["ok"],
      optional: 4,
    });
    for (const input of [
      { id: "2", names: ["ok"] },
      { id: 1, names: ["ok"] },
      { id: 2, names: [] },
      { id: 2, names: ["ok", "ok"] },
      { id: 2, names: ["x"] },
      { id: 2, names: ["ok"], extra: 1 },
    ]) {
      expect(validator.safeParse(input).success).toBe(false);
    }
  });

  it("preserves original schemas and does not mutate arguments or inject defaults", () => {
    const inputSchema = {
      type: "object" as const,
      properties: { optional: { type: "string", default: "hello" } },
    };
    const { tool } = wrapMCPTool({ name: "demo", inputSchema }, "server", client);
    const registry = new ToolRegistry();
    registry.register(tool);
    expect(registry.getToolDefinitionsForLLM()[0]?.input_schema).toEqual(inputSchema);
    const input = { untouched: { value: 1 } };
    expect(tool.parameters.parse(input)).toEqual(input);
    expect(input).toEqual({ untouched: { value: 1 } });
  });

  it("enforces oneOf exclusivity, formats and 2020 unevaluated properties", () => {
    const validator = compileMCPInputSchema({
      type: "object",
      properties: {
        value: { oneOf: [{ type: "number" }, { minimum: 1, type: "number" }] },
        email: { type: "string", format: "email" },
      },
      unevaluatedProperties: false,
    });
    expect(validator.safeParse({ value: 2 }).success).toBe(false);
    expect(validator.safeParse({ value: -1, email: "wrong" }).success).toBe(false);
    expect(validator.safeParse({ value: -1, email: "a@example.com" }).success).toBe(true);
    expect(validator.safeParse({ extra: true }).success).toBe(false);
  });

  it("isolates unsupported tools while retaining valid tools", () => {
    const schemas = [
      { type: "object", $async: true },
      { type: "object", $schema: "https://example.com/schema" },
      { type: "object", properties: { a: { $ref: "https://example.com/schema" } } },
      { type: "object", properties: { a: { mysteryConstraint: 1 } } },
    ];
    const tools = schemas.map((inputSchema, i) => ({ name: `bad${i}`, inputSchema })) as MCPTool[];
    tools.push({ name: "good", inputSchema: { type: "object" } });
    expect(wrapMCPTools(tools, "test", client).tools.map((t) => t.name)).toEqual(["mcp_test_good"]);
  });

  it("rejects invalid arguments before any remote side effect", async () => {
    client.callTool = vi.fn();
    const { tool } = wrapMCPTool(
      {
        name: "write",
        inputSchema: {
          type: "object",
          properties: { count: { type: "integer", minimum: 1 } },
          required: ["count"],
        },
      },
      "test",
      client,
    );
    const registry = new ToolRegistry();
    registry.register(tool);
    expect((await registry.execute(tool.name, { count: 0 })).success).toBe(false);
    expect(client.callTool).not.toHaveBeenCalled();
  });
});
