import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../../scripts/release-metadata.mjs", import.meta.url));
describe("release metadata", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "coco-release-metadata-"));
    await mkdir(path.join(dir, "vscode-extension"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  async function run(tag: string, version: string, name = "@corbat-tech/coco") {
    const filename = tag.startsWith("vscode-v") ? "vscode-extension/package.json" : "package.json";
    await writeFile(path.join(dir, filename), JSON.stringify({ name, version }));
    return spawnSync(process.execPath, [script, tag], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
    });
  }

  it.each([
    ["v2.42.0", "2.42.0", "latest"],
    ["v2.42.0-rc.1", "2.42.0-rc.1", "next"],
  ])("routes %s to its explicit dist-tag", async (tag, version, channel) => {
    const result = await run(tag, version);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`version=${version}\nchannel=${channel}\n`);
  });
  it.each(["v2.42.1", "other", "v2.42.0\nchannel=latest"])(
    "rejects invalid or mismatched tag %s",
    async (tag) => {
      const result = await run(tag, "2.42.0");
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
    },
  );
  it("rejects the wrong package identity", async () => {
    expect((await run("v2.42.0", "2.42.0", "different-package")).status).not.toBe(0);
  });
  it("validates the extension against its own version", async () => {
    expect((await run("vscode-v2.40.0", "2.40.0", "corbat-coco")).status).toBe(0);
  });
  it("does not silently publish a VSIX prerelease as stable", async () => {
    expect((await run("vscode-v2.40.0-rc.1", "2.40.0-rc.1", "corbat-coco")).status).not.toBe(0);
  });
});
