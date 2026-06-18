import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  lspDefinitionTool,
  lspDocumentSymbolsTool,
  lspReferencesTool,
  lspStatusTool,
  lspTools,
  lspWorkspaceSymbolsTool,
} from "./lsp.js";

describe("lsp tools", () => {
  it("exports all optional LSP-style tools", () => {
    expect(lspTools.map((tool) => tool.name)).toEqual([
      "lsp_status",
      "lsp_document_symbols",
      "lsp_workspace_symbols",
      "lsp_definition",
      "lsp_references",
    ]);
  });

  it("reports language server availability with static fallback", async () => {
    const result = await lspStatusTool.execute({});

    expect(result.fallbackMode).toBe("static-analysis");
    expect(result.languageServers.map((server) => server.name)).toContain(
      "typescript-language-server",
    );
  });

  it("finds document symbols, workspace symbols, definitions, and references", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "coco-lsp-"));
    try {
      const filePath = path.join(tmpDir, "sample.ts");
      await writeFile(
        filePath,
        [
          "export interface UserRecord { id: string }",
          "export function loadUser(): UserRecord {",
          "  return { id: '1' };",
          "}",
          "const value = loadUser();",
        ].join("\n"),
      );

      const documentSymbols = await lspDocumentSymbolsTool.execute({ file: filePath });
      expect(documentSymbols.symbols.map((symbol) => symbol.name)).toContain("loadUser");

      const workspaceSymbols = await lspWorkspaceSymbolsTool.execute({
        query: "load",
        path: tmpDir,
      });
      expect(workspaceSymbols.symbols[0]?.name).toBe("loadUser");

      const definition = await lspDefinitionTool.execute({ symbol: "loadUser", path: tmpDir });
      expect(definition.definition?.file).toBe("sample.ts");
      expect(definition.definition?.line).toBe(2);

      const references = await lspReferencesTool.execute({ symbol: "loadUser", path: tmpDir });
      expect(references.references.map((reference) => reference.line)).toEqual([2, 5]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
