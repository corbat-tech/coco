import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishNpm } from "../../scripts/publish-npm.mjs";

describe("npm publication reconciliation", () => {
  let dir: string;
  let integrity: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "coco-publish-"));
    await writeFile(path.join(dir, "coco.tgz"), "fixture bytes");
    integrity = "sha512-" + createHash("sha512").update("fixture bytes").digest("base64");
    await writeFile(
      path.join(dir, "pack.json"),
      JSON.stringify([
        { name: "@corbat-tech/coco", version: "2.42.0", filename: "coco.tgz", integrity },
      ]),
    );
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));
  it("skips publishing an identical immutable version", async () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: JSON.stringify(integrity) });
    expect(await publishNpm(dir, "latest", run)).toBe("already-published");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("publishes only after explicit not-found and disables lifecycle rebuild", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 0, stdout: "" });
    expect(await publishNpm(dir, "next", run)).toBe("published");
    expect(run.mock.calls[1]?.[0]).toEqual([
      "publish",
      path.join(dir, "coco.tgz"),
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      "next",
    ]);
  });
  it.each([
    { status: 0, stdout: '"different"' },
    { status: 1, stdout: '{"error":{"code":"E401"}}' },
    { status: 1, stdout: "network failure" },
    { status: null, stdout: "", signal: "SIGTERM" },
  ])("does not publish on conflicting or unknown state %j", async (query) => {
    const run = vi.fn().mockReturnValue(query);
    await expect(publishNpm(dir, "latest", run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not retry an uncertain publication in the same run", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: null, signal: "SIGTERM" });
    await expect(publishNpm(dir, "latest", run)).rejects.toThrow("uncertain");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("rejects changed tarball bytes before any registry access", async () => {
    await writeFile(path.join(dir, "coco.tgz"), "changed");
    const run = vi.fn();
    await expect(publishNpm(dir, "latest", run)).rejects.toThrow("Artifact changed");
    expect(run).not.toHaveBeenCalled();
  });
});
