import { mkdtemp, mkdir, writeFile, rm, readFile, rename, symlink } from "node:fs/promises";
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

  it("invalidates the cache when symbols change and files are renamed or deleted", async () => {
    const root = await makeRepo();
    await getRepoContext({ path: root, query: "provider" });
    await writeFile(
      join(root, "src/providers/openai.ts"),
      "export function renamedCapability() {}\n",
    );
    const changed = await getRepoContext({ path: root, query: "renamedCapability" });
    expect(
      changed.items[0]?.definitions.some((symbol) => symbol.name === "renamedCapability"),
    ).toBe(true);
    await rename(join(root, "src/providers/openai.ts"), join(root, "src/providers/renamed.ts"));
    const moved = await getRepoContext({ path: root, query: "renamedCapability" });
    expect(moved.items[0]?.path).toBe("src/providers/renamed.ts");
    await rm(join(root, "src/providers/renamed.ts"));
    const deleted = await getRepoContext({ path: root, query: "renamedCapability" });
    expect(deleted.items.some((item) => item.path === "src/providers/renamed.ts")).toBe(false);
  });
  it("rebuilds malformed cached data instead of trusting a JSON cast", async () => {
    const root = await makeRepo();
    await getRepoContext({ path: root, query: "provider" });
    const cache = join(root, ".coco/cache/repo-index.json");
    const value = JSON.parse(await readFile(cache, "utf8"));
    value.graph.files[0].definitions = "invalid";
    await writeFile(cache, JSON.stringify(value));
    const result = await getRepoContext({ path: root, query: "provider" });
    expect(result.items.length).toBeGreaterThan(0);
    expect(Array.isArray(result.items[0]?.definitions)).toBe(true);
  });
  it("honors the additional token budget without changing the file-count budget", async () => {
    const root = await makeRepo();
    const result = await getRepoContext({
      path: root,
      query: "provider tools",
      budget: 2,
      tokenBudget: 500,
    });
    expect(result.budget).toBe(2);
    expect(result.items.length).toBeLessThanOrEqual(2);
    expect(result.estimatedTokens).toBeLessThanOrEqual(500);
    expect(Buffer.byteLength(JSON.stringify(result.items), "utf8")).toBe(result.estimatedTokens);
    expect(result.omittedItems).toBeGreaterThan(0);
  });
  it("resolves relative imports from the importing directory for ranking", async () => {
    const root = await makeRepo();
    const result = await getRepoContext({ path: root, query: "defineTool", budget: 12 });
    expect(result.items.find((item) => item.path === "src/tools/registry.ts")?.reasons).toContain(
      "centrality:1",
    );
  });

  it.each(["directory", "leaf"])(
    "never follows a cache %s symlink to external files",
    async (kind) => {
      const root = await makeRepo();
      const outside = await mkdtemp(join(tmpdir(), "coco-cache-outside-"));
      try {
        const sentinel = join(outside, "sentinel.json");
        await writeFile(sentinel, "external-data");
        if (kind === "directory") await symlink(outside, join(root, ".coco"));
        else {
          await mkdir(join(root, ".coco/cache"), { recursive: true });
          await symlink(sentinel, join(root, ".coco/cache/repo-index.json"));
        }
        const result = await getRepoContext({ path: root, query: "provider" });
        expect(result.items.length).toBeGreaterThan(0);
        expect(await readFile(sentinel, "utf8")).toBe("external-data");
        await expect(readFile(join(outside, "cache/repo-index.json"))).rejects.toThrow();
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

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
