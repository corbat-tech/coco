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
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ latest: "2.42.0" }) });
    expect(await publishNpm(dir, "latest", run)).toBe("already-published");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("publishes only after explicit not-found and disables lifecycle rebuild", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 0, stdout: '"publisher"' })
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"next":"2.42.0"}' });
    expect(await publishNpm(dir, "next", run)).toBe("published");
    expect(run.mock.calls[2]?.[0]).toEqual([
      "publish",
      path.join(dir, "coco.tgz"),
      "--json",
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
      .mockReturnValueOnce({ status: 0, stdout: '"publisher"' })
      .mockReturnValueOnce({ status: null, signal: "SIGTERM" });
    await expect(publishNpm(dir, "latest", run)).rejects.toThrow("uncertain");
    expect(run).toHaveBeenCalledTimes(3);
  });
  it.each(["E401", "E403", "EOTP", "ETIMEDOUT", "ECONNRESET"])(
    "reports safe publication diagnosis %s",
    async (code) => {
      const run = vi
        .fn()
        .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
        .mockReturnValueOnce({ status: 0, stdout: '"publisher"' })
        .mockReturnValueOnce({
          status: 1,
          stdout: JSON.stringify({ error: { code, summary: "npm_secret_123" } }),
          stderr: "Authorization: Bearer sensitive",
        });
      const error = await publishNpm(dir, "next", run).catch((e) => e as Error);
      expect(error.message).toContain(code);
      expect(error.message).not.toMatch(/npm_secret|sensitive|Authorization/);
      expect(run).toHaveBeenCalledTimes(3);
    },
  );
  it("stops before publishing when authentication fails", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 1, stderr: "npm error code E401\nsecret" });
    await expect(publishNpm(dir, "next", run)).rejects.toThrow(/no publish attempted: E401/);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("publishes with OIDC without token-only whoami", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"next":"2.42.0"}' });
    expect(
      await publishNpm(dir, "next", run, {
        authMode: "oidc",
        env: {
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://fixture.invalid",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-identity",
        },
      }),
    ).toBe("published");
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["view", "publish", "view", "view"]);
  });
  it.each([
    {},
    { GITHUB_ACTIONS: "true" },
    {
      GITHUB_ACTIONS: "true",
      ACTIONS_ID_TOKEN_REQUEST_URL: "fixture",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "identity",
      NODE_AUTH_TOKEN: "secret",
    },
  ])("blocks OIDC with missing identity or token fallback", async (env) => {
    const run = vi.fn();
    await expect(publishNpm(dir, "next", run, { authMode: "oidc", env })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("does not silently move a mismatched channel for an identical version", async () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"latest":"2.41.0"}' });
    await expect(publishNpm(dir, "next", run)).rejects.toThrow(/dist-tag/);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("sanitizes malformed successful registry output", async () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: "npm_secret_not_json" });
    const error = await publishNpm(dir, "next", run).catch((e) => e as Error);
    expect(error.message).toContain("Registry state unknown");
    expect(error.message).not.toContain("npm_secret");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects changed tarball bytes before any registry access", async () => {
    await writeFile(path.join(dir, "coco.tgz"), "changed");
    const run = vi.fn();
    await expect(publishNpm(dir, "latest", run)).rejects.toThrow("Artifact changed");
    expect(run).not.toHaveBeenCalled();
  });
  function pollingClock() {
    let time = 0;
    const wait = vi.fn(async (ms: number) => {
      time += ms;
    });
    return { visibilityTimeoutMs: 45000, pollIntervalMs: 15000, now: () => time, wait };
  }
  function acceptedSubmission() {
    return vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 0, stdout: '"publisher"' })
      .mockReturnValueOnce({ status: 0, stdout: "" });
  }
  it("polls E404 and an old dist-tag after acknowledgement without resubmitting", async () => {
    const clock = pollingClock();
    const run = acceptedSubmission()
      .mockReturnValueOnce({ status: 1, stdout: '{"error":{"code":"E404"}}' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"next":"2.41.0"}' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"next":"2.42.0"}' });
    await expect(publishNpm(dir, "next", run, clock)).resolves.toBe("published");
    expect(clock.wait.mock.calls).toEqual([[15000], [15000]]);
    expect(run.mock.calls.filter(([args]) => args[0] === "publish")).toHaveLength(1);
    expect(run.mock.calls.every(([args]) => ["view", "whoami", "publish"].includes(args[0]))).toBe(
      true,
    );
    expect(run.mock.calls[3]?.[1]).toEqual({ timeout: 45000, killSignal: "SIGKILL" });
    expect(run.mock.calls.at(-1)?.[1]).toEqual({ timeout: 15000, killSignal: "SIGKILL" });
  });
  it("stops polling immediately if visible integrity conflicts", async () => {
    const clock = pollingClock();
    const run = acceptedSubmission().mockReturnValue({ status: 0, stdout: '"conflict"' });
    await expect(publishNpm(dir, "next", run, clock)).rejects.toThrow("different integrity");
    expect(run).toHaveBeenCalledTimes(4);
    expect(clock.wait).not.toHaveBeenCalled();
  });
  it("expires pending visibility without another publish or dist-tag mutation", async () => {
    const clock = pollingClock();
    const run = acceptedSubmission().mockReturnValue({
      status: 1,
      stdout: '{"error":{"code":"E404"}}',
    });
    await expect(publishNpm(dir, "next", run, clock)).rejects.toThrow(
      "visibility deadline expired",
    );
    expect(clock.now()).toBe(45000);
    expect(clock.wait).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(6);
    expect(run.mock.calls.filter(([args]) => args[0] === "publish")).toHaveLength(1);
  });
  it.each([
    { status: 1, stdout: '{"error":{"code":"E401","summary":"secret-value"}}' },
    { status: 0, stdout: "secret-value" },
    { status: 0, stdout: "{}" },
    { status: null, signal: "SIGKILL", stderr: "secret-value" },
  ])("stops unknown verification failures without exposing raw output: %j", async (result) => {
    const clock = pollingClock();
    const run = acceptedSubmission().mockReturnValue(result);
    const error = await publishNpm(dir, "next", run, clock).catch((reason: Error) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain("secret-value");
    expect(run).toHaveBeenCalledTimes(4);
    expect(clock.wait).not.toHaveBeenCalled();
  });
  it("rejects malformed channel data rather than treating it as delayed indexing", async () => {
    const clock = pollingClock();
    const run = acceptedSubmission()
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(integrity) })
      .mockReturnValueOnce({ status: 0, stdout: '{"next":{"token":"secret-value"}}' });
    const error = await publishNpm(dir, "next", run, clock).catch((reason: Error) => reason);
    expect(error.message).toContain("Channel state unknown");
    expect(error.message).not.toContain("secret-value");
    expect(clock.wait).not.toHaveBeenCalled();
  });
});
