import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
const io = vi.hoisted(() => ({
  root: "",
  load: vi.fn(),
  exec: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
  outro: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: io.outro,
  log: io.log,
  text: io.text,
  select: io.select,
  confirm: io.confirm,
  isCancel: (value: unknown) => typeof value === "symbol",
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("execa", () => ({ execaSync: io.exec }));
vi.mock("../../config/loader.js", () => ({ loadConfig: io.load }));
vi.mock("../../config/paths.js", async (original) => ({
  ...(await original<typeof import("../../config/paths.js")>()),
  CONFIG_PATHS: {
    get skills() {
      return path.join(io.root, "global/skills");
    },
  },
}));
vi.mock("../repl/skills/index.js", () => ({ getBuiltinSkillsForDiscovery: () => [] }));
import { registerSkillsCommand } from "./skills.js";
import { loadMarkdownMetadata } from "../../skills/loader/markdown-loader.js";

async function run(...args: string[]) {
  const program = new Command();
  program.exitOverride();
  registerSkillsCommand(program);
  await program.parseAsync(["skills", ...args], { from: "user" });
}
async function skill(scope: string, name: string, description = "Useful coding skill") {
  const dir = path.join(io.root, scope, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nversion: 2.0.0\nmetadata:\n  author: fixture-author\n  tags: [testing]\n  category: testing\n---\n${Array.from({ length: 12 }, (_, i) => `Instruction ${i + 1}`).join("\n")}`,
  );
  return dir;
}

describe("skills CLI behavior", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    io.root = await fs.mkdtemp(path.join(os.tmpdir(), "coco skills-cli-"));
    vi.spyOn(process, "cwd").mockReturnValue(io.root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    io.load.mockImplementation(async () => ({
      skills: {
        globalDirs: [path.join(io.root, "global/skills")],
        projectDirs: [path.join(io.root, ".claude/skills"), path.join(io.root, ".agents/skills")],
      },
    }));
    io.text.mockResolvedValue('Use "quotes"\nand preserve metadata');
    io.select.mockResolvedValue("testing");
    io.confirm.mockResolvedValue(true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(io.root, { recursive: true, force: true });
  });

  it("creates discoverable metadata with quoted multiline descriptions and refuses overwrite", async () => {
    await run("create", "safe-skill");
    const dir = path.join(io.root, ".agents/skills/safe-skill");
    expect((await loadMarkdownMetadata(dir, "project"))?.description).toBe(
      'Use "quotes"\nand preserve metadata',
    );
    expect((await fs.stat(path.join(dir, "references"))).isDirectory()).toBe(true);
    const before = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    await run("create", "safe-skill");
    expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe(before);
  });
  it.each(["../escaped", "../../outside", "/absolute", "."])(
    "rejects escaping create name %s before prompting",
    async (name) => {
      await run("create", name);
      expect(io.text).not.toHaveBeenCalled();
      expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("Invalid skill name"));
      expect(await fs.readdir(io.root)).toEqual([]);
    },
  );
  it.each(["description", "category"])("cancels %s input without creating files", async (stage) => {
    (stage === "description" ? io.text : io.select).mockResolvedValue(Symbol("cancel"));
    await run("create", "cancelled");
    expect(await fs.readdir(io.root)).toEqual([]);
  });
  it("installs local skill including resources to global directory without invoking subprocess", async () => {
    const source = await skill("source", "copied");
    await fs.writeFile(path.join(source, "reference.txt"), "user reference");
    await run("add", source, "--global");
    expect(
      await fs.readFile(path.join(io.root, "global/skills/copied/reference.txt"), "utf8"),
    ).toBe("user reference");
    expect(io.exec).not.toHaveBeenCalled();
  });
  it("reports missing local source without success", async () => {
    await run("add", path.join(io.root, "missing"));
    expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to copy"));
    expect(io.log.success).not.toHaveBeenCalled();
  });
  it("passes hostile registry source as one argument without shell interpretation", async () => {
    const source = "owner/repo; touch injected";
    await run("add", source, "--global");
    expect(io.exec).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", source, "-g"],
      expect.objectContaining({ cwd: io.root, timeout: 120000 }),
    );
    expect(await fs.readdir(io.root)).toEqual([]);
  });
  it("clones a direct URL into one path argument even when parent has spaces", async () => {
    const source = "https://example.invalid/skill.git";
    await run("add", source);
    expect(io.exec).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "--", source, path.join(io.root, ".agents/skills/skill")],
      expect.objectContaining({ timeout: 60000 }),
    );
  });
  it.each(["owner/repo", "https://example.invalid/skill.git"])(
    "surfaces installer stderr for %s",
    async (source) => {
      io.exec.mockImplementation(() => {
        throw Object.assign(new Error("command failed"), {
          stderr: Buffer.from("authentication denied"),
        });
      });
      await run("add", source);
      expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("authentication denied"));
      expect(io.log.success).not.toHaveBeenCalled();
    },
  );
  it("rejects unsupported source and URL directory traversal without spawning", async () => {
    await run("add", "unknown");
    await run("add", "https://example.invalid/..");
    expect(io.exec).not.toHaveBeenCalled();
    expect(io.log.error).toHaveBeenCalledTimes(2);
  });
  it("keeps installed files when removal is cancelled, and removes only selected skill with yes", async () => {
    const selected = await skill(".agents/skills", "selected");
    const survivor = await skill(".agents/skills", "survivor");
    io.confirm.mockResolvedValue(false);
    await run("remove", "selected");
    expect(await fs.readFile(path.join(selected, "SKILL.md"), "utf8")).toContain("selected");
    await run("remove", "selected", "--yes");
    await expect(fs.access(selected)).rejects.toThrow();
    expect(await fs.readFile(path.join(survivor, "SKILL.md"), "utf8")).toContain("survivor");
    expect(io.confirm).toHaveBeenCalledTimes(1);
  });
  it("refuses escaping and missing removal paths", async () => {
    await run("remove", "../../sentinel", "--yes");
    await run("remove", "missing", "--global", "--yes");
    expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("Invalid skill name"));
    expect(io.log.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(io.confirm).not.toHaveBeenCalled();
  });
  it("lists discovered project skills with scope/kind filters and handles empty result", async () => {
    await skill("global/skills", "global-skill");
    await skill(".agents/skills", "project-skill");
    await run("list", "--scope", "project", "--kind", "markdown");
    const displayed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(displayed).toContain("project-skill");
    expect(displayed).not.toContain("global-skill");
    expect(io.outro).toHaveBeenCalledWith("Total: 1 skills");
    await run("list", "--kind", "native");
    expect(io.log.info).toHaveBeenCalledWith("No skills found.");
  });
  it("shows real markdown metadata and a bounded instruction preview", async () => {
    await skill(".agents/skills", "inspected");
    await run("info", "inspected");
    const displayed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(displayed).toContain("fixture-author");
    expect(displayed).toContain("Instruction 10");
    expect(displayed).not.toContain("Instruction 11");
    await run("info", "missing");
    expect(io.log.error).toHaveBeenCalledWith('Skill "missing" not found.');
  });
  it("doctor explains project precedence and disabled conflicting winners", async () => {
    await skill("global/skills", "shared");
    await skill(".claude/skills", "shared");
    const winner = await skill(".agents/skills", "shared");
    const config = await io.load();
    config.skills.disabled = ["shared"];
    io.load.mockResolvedValue(config);
    await run("doctor");
    const displayed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(displayed).toContain(`winner: ${winner} [project]`);
    expect(displayed).toContain("[DISABLED]");
    expect(io.log.step).toHaveBeenCalledWith("Final active skills: 0");
    expect(io.log.step).toHaveBeenCalledWith("Conflicts detected: 1");
  });
  it("doctor reports no conflicts for an empty configured directory", async () => {
    await run("doctor");
    expect(io.log.success).toHaveBeenCalledWith("No naming conflicts detected.");
  });
});
