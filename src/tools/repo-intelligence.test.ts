import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getRepoContext, repoContextTool } from "./repo-intelligence.js";

let tmp: string | undefined;

async function makeRepo(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "coco-repo-context-"));
  await mkdir(join(tmp, "src", "providers"), { recursive: true });
  await mkdir(join(tmp, "src", "tools"), { recursive: true });
  await writeFile(
    join(tmp, "src", "providers", "openai.ts"),
    [
      'import { defineTool } from "../tools/registry.js";',
      "export interface ProviderRuntimeCapability { endpoint: string }",
      "export function getProviderRuntimeCapability() { return { endpoint: 'openai-responses' }; }",
    ].join("\n"),
  );
  await writeFile(
    join(tmp, "src", "tools", "registry.ts"),
    ["export function defineTool() { return {}; }"].join("\n"),
  );
  await writeFile(
    join(tmp, "src", "providers", "openai.test.ts"),
    [
      "import { getProviderRuntimeCapability } from './openai.js';",
      "export const testName = 'x';",
    ].join("\n"),
  );
  return tmp;
}

afterEach(async () => {
  if (tmp) {
    await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

describe("repo intelligence", () => {
  it("ranks files by query terms and symbols", async () => {
    const root = await makeRepo();
    const result = await getRepoContext({
      path: root,
      query: "provider runtime capability openai responses",
      refresh: true,
    });

    expect(result.items[0]?.path).toBe("src/providers/openai.ts");
    expect(result.items[0]?.reasons.join(" ")).toContain("symbol");
  });

  it("biases tests in review/debug modes", async () => {
    const root = await makeRepo();
    const result = await getRepoContext({
      path: root,
      query: "openai provider test",
      mode: "review",
      refresh: true,
    });

    expect(result.items.some((item) => item.path.endsWith("openai.test.ts"))).toBe(true);
  });

  it("registers the repo_context tool", async () => {
    const root = await makeRepo();
    const result = await repoContextTool.execute({
      path: root,
      query: "define tool",
      refresh: true,
      budget: 1,
    });

    expect(result.items).toHaveLength(1);
  });
});
