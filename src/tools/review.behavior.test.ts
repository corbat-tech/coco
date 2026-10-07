import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { reviewCodeTool } from "./review.js";
import { runLinterTool } from "./quality.js";
let root: string;
const git = (...args: string[]) => execa("git", args, { cwd: root });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "coco-review-"));
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture");
  await git("config", "user.email", "fixture@example.invalid");
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/app.ts"), "export const total = 1;\n");
  await git("add", ".");
  await git("commit", "-m", "fixture");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const review = (options = {}) =>
  reviewCodeTool.execute({
    cwd: root,
    baseBranch: "main",
    includeUncommitted: true,
    runLinter: false,
    ...options,
  });
describe("review evidence against actual git state", () => {
  it("does not approve a review whose requested base does not exist", async () => {
    const result = await review({ baseBranch: "missing-base" });
    expect(result.summary.status).toBe("needs_work");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("missing-base")]),
    );
  });
  it("distinguishes a verified empty diff from an unavailable diff", async () => {
    expect((await review()).summary).toMatchObject({ filesChanged: 0, status: "approved" });
  });
  it("finds introduced injection and retains all working tree and index bytes", async () => {
    await fs.writeFile(path.join(root, "src/app.ts"), "export const total = eval(input);\n");
    await git("add", "src/app.ts");
    const before = await git("diff", "--cached");
    const source = await fs.readFile(path.join(root, "src/app.ts"));
    const result = await review();
    expect(result.summary.status).toBe("needs_work");
    expect(result.required).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "critical", category: "security" }),
      ]),
    );
    expect(result.diff.files.every((file) => file.hunks.length === 0)).toBe(true);
    expect((await git("diff", "--cached")).stdout).toBe(before.stdout);
    expect(await fs.readFile(path.join(root, "src/app.ts"))).toEqual(source);
  });
  it("honors excluding uncommitted changes and includes committed feature changes", async () => {
    await git("switch", "-c", "feature");
    await fs.writeFile(path.join(root, "src/app.ts"), "export const total = 2;\n");
    expect((await review({ includeUncommitted: false })).summary.filesChanged).toBe(0);
    await git("add", ".");
    await git("commit", "-m", "feature");
    expect((await review({ includeUncommitted: false })).summary.filesChanged).toBe(1);
  });
  it("does not approve when requested linting is unavailable", async () => {
    await fs.writeFile(path.join(root, "src/app.ts"), "export const total = 2;\n");
    const result = await review({ runLinter: true });
    expect(result.summary.status).toBe("needs_work");
    expect(result.warnings?.join(" ")).toContain("No linter detected");
  });
  it("reports a linter failure without interpreting it as a clean review", async () => {
    await fs.writeFile(path.join(root, "src/app.ts"), "export const total = 2;\n");
    vi.spyOn(runLinterTool, "execute").mockRejectedValue(new Error("linter crashed"));
    const result = await review({ runLinter: true });
    expect(result.summary.status).toBe("needs_work");
    expect(result.warnings?.join(" ")).toContain("not checked");
  });
  it("includes requested lint findings only on the changed lines", async () => {
    await fs.writeFile(path.join(root, "src/app.ts"), "export const total = 2;\n");
    vi.spyOn(runLinterTool, "execute").mockResolvedValue({
      score: 70,
      errors: 2,
      warnings: 0,
      fixable: 0,
      issues: [
        {
          file: path.join(root, "src/app.ts"),
          line: 1,
          column: 1,
          severity: "error",
          rule: "fixture",
          message: "changed-line violation",
        },
        {
          file: path.join(root, "src/app.ts"),
          line: 50,
          column: 1,
          severity: "error",
          rule: "fixture",
          message: "unrelated old issue",
        },
      ],
    });
    const result = await review({ runLinter: true });
    expect(result.required.map((finding) => finding.message)).toContain(
      "[fixture] changed-line violation",
    );
    expect(JSON.stringify(result)).not.toContain("unrelated old issue");
  });
  it("fails explicitly outside a repository", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coco-no-git-"));
    try {
      await expect(review({ cwd: dir })).rejects.toThrow("Code review failed");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
