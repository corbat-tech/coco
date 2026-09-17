import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
const io = vi.hoisted(() => ({
  file: "",
  confirm: vi.fn(),
  text: vi.fn(),
  outro: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: io.outro,
  confirm: io.confirm,
  text: io.text,
  isCancel: (v: unknown) => typeof v === "symbol",
  log: { error: io.error, message: io.message },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("../../mcp/registry.js", async (original) => {
  const actual = await original<typeof import("../../mcp/registry.js")>();
  return { ...actual, createMCPRegistry: () => actual.createMCPRegistry(io.file) };
});
import { registerMCPCommand } from "./mcp.js";
async function run(...args: string[]) {
  const program = new Command();
  program.exitOverride();
  registerMCPCommand(program);
  await program.parseAsync(["mcp", ...args], { from: "user" });
}
async function saved() {
  return JSON.parse(await fs.readFile(io.file, "utf8")).servers;
}
describe("MCP CLI persisted configuration", () => {
  let root: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "coco-mcp-cli-"));
    io.file = path.join(root, "registry.json");
    io.confirm.mockResolvedValue(true);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  it("round-trips stdio arguments and environment values containing equals or empty values", async () => {
    await run(
      "add",
      "local",
      "--command",
      "node",
      "--args",
      "server.js, --safe",
      "--env",
      "TOKEN=a=b==,EMPTY=, BAD=ok",
      "--description",
      "Local tools",
    );
    expect((await saved())[0]).toMatchObject({
      name: "local",
      enabled: true,
      description: "Local tools",
      stdio: {
        command: "node",
        args: ["server.js", "--safe"],
        env: { TOKEN: "a=b==", EMPTY: "", BAD: "ok" },
      },
    });
  });
  it("supports HTTP configuration and prompts for missing URL or command", async () => {
    io.text.mockResolvedValueOnce("https://example.invalid/mcp").mockResolvedValueOnce("node");
    await run("add", "remote", "--transport", "http");
    await run("add", "local");
    expect(await saved()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ http: { url: "https://example.invalid/mcp" } }),
        expect.objectContaining({ stdio: { command: "node" } }),
      ]),
    );
  });
  it.each(["stdio", "http"])(
    "cancels incomplete %s configuration without creating registry",
    async (transport) => {
      io.text.mockResolvedValue(Symbol("cancel"));
      await run("add", "cancelled", "--transport", transport);
      await expect(fs.access(io.file)).rejects.toThrow();
    },
  );
  it("preserves existing server when overwrite is rejected and replaces it when confirmed", async () => {
    await run("add", "server", "--command", "old");
    io.confirm.mockResolvedValue(false);
    await run("add", "server", "--command", "new");
    expect((await saved())[0].stdio.command).toBe("old");
    io.confirm.mockResolvedValue(true);
    await run("add", "server", "--command", "new");
    expect((await saved())[0].stdio.command).toBe("new");
  });
  it.each([
    ["--transport", "invalid"],
    ["--transport", "http", "--url", "invalid"],
    ["--command", "node"],
  ])("rejects invalid config without saving: %j", async (...options) => {
    await expect(run("add", "invalid/name", ...options)).rejects.toThrow("exit:1");
    await expect(fs.access(io.file)).rejects.toThrow();
  });
  it("toggles persisted state, lists disabled only on request, and preserves transport", async () => {
    await run("add", "server", "--command", "node", "--description", "Tools");
    await run("disable", "server");
    await run("disable", "server");
    expect((await saved())[0]).toMatchObject({ enabled: false, stdio: { command: "node" } });
    await run("list");
    expect(io.outro).toHaveBeenCalledWith(expect.stringContaining("No enabled"));
    await run("list", "--all");
    expect(io.message).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    await run("enable", "server");
    await run("enable", "server");
    expect((await saved())[0].enabled).toBe(true);
    expect(io.outro).toHaveBeenCalledWith("Server 'server' is already enabled");
    await run("list");
    expect(io.outro).toHaveBeenCalledWith("Total: 1 server");
  });
  it("removes only confirmed server and preserves unrelated registration", async () => {
    await run("add", "one", "--command", "node");
    await run("add", "two", "--transport", "http", "--url", "https://example.invalid");
    io.confirm.mockResolvedValue(Symbol("cancel"));
    await run("remove", "one");
    expect(await saved()).toHaveLength(2);
    await run("remove", "one", "--yes");
    expect((await saved()).map((v: { name: string }) => v.name)).toEqual(["two"]);
    await run("list", "--all");
    expect(io.message).toHaveBeenCalledWith(expect.stringContaining("http:"));
  });
  it.each(["remove", "enable", "disable"])(
    "rejects %s on absent server without saving",
    async (action) => {
      await expect(run(action, "missing")).rejects.toThrow("exit:1");
      await expect(fs.access(io.file)).rejects.toThrow();
    },
  );
  it("reports storage failure without success or corrupting the existing directory", async () => {
    await fs.mkdir(io.file);
    await expect(run("add", "server", "--command", "node")).rejects.toThrow("exit:1");
    expect(io.error).toHaveBeenCalledWith(expect.stringContaining("Failed to save registry"));
    expect((await fs.stat(io.file)).isDirectory()).toBe(true);
    expect(io.outro).not.toHaveBeenCalledWith("Done");
  });
  it("lists an empty registry honestly", async () => {
    await run("list", "--all");
    expect(io.outro).toHaveBeenCalledWith("No MCP servers registered");
  });
});
