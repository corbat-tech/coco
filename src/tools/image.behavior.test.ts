import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const io = vi.hoisted(() => ({ anthropic: vi.fn(), openai: vi.fn(), gemini: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: io.anthropic };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: io.openai } };
  },
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: io.gemini };
  },
}));
import { readImageTool } from "./image.js";
import { ToolRegistry } from "./registry.js";
import { RuntimeToolExecutor } from "../runtime/runtime-tool-executor.js";

describe("authorized image upload with isolated fixtures and simulated SDKs", () => {
  let temporary: string, root: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "coco-image-contract-"));
    root = path.join(temporary, "project");
    await fs.mkdir(root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("GOOGLE_API_KEY", "fixture-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    await fs.writeFile(path.join(root, "local.png"), Buffer.from("local image bytes"));
    io.anthropic.mockResolvedValue({ content: [{ type: "text", text: "Anthropic description" }] });
    io.openai.mockResolvedValue({ choices: [{ message: { content: "OpenAI description" } }] });
    io.gemini.mockResolvedValue({ text: "Gemini description" });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  it.each(["anthropic", "openai", "gemini"] as const)(
    "explicitly authorized %s receives only the selected local bytes",
    async (provider) => {
      const registry = new ToolRegistry();
      registry.register(readImageTool);
      const result = await new RuntimeToolExecutor({ toolRegistry: registry }).execute({
        toolName: "read_image",
        input: { path: "local.png", provider, prompt: "Describe safely" },
        mode: "build",
        confirmed: true,
      });
      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({ provider, imageSize: 17, format: "png" });
      const called = io[provider];
      expect(called).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(called.mock.calls[0])).toContain(
        Buffer.from("local image bytes").toString("base64"),
      );
      expect(JSON.stringify(called.mock.calls[0])).toContain("Describe safely");
      expect(Object.values(io).filter((mock) => mock.mock.calls.length)).toHaveLength(1);
    },
  );
  it.each(["anthropic", "openai", "gemini"] as const)(
    "forwards cancellation to %s and rejects late results",
    async (provider) => {
      const controller = new AbortController();
      io[provider].mockImplementationOnce(async (...args: unknown[]) => {
        const forwarded =
          provider === "gemini"
            ? (args[0] as { config: { abortSignal?: AbortSignal } }).config.abortSignal
            : (args[1] as { signal?: AbortSignal }).signal;
        expect(forwarded).toBe(controller.signal);
        controller.abort(new Error("cancelled image"));
        return { content: [], choices: [], text: "late" };
      });
      await expect(
        readImageTool.execute({ path: "local.png", provider }, { signal: controller.signal }),
      ).rejects.toThrow("cancelled image");
    },
  );
  it("pre-cancelled upload never reads a missing file or invokes SDK", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before read"));
    await expect(
      readImageTool.execute({ path: "missing.png" }, { signal: controller.signal }),
    ).rejects.toThrow("cancelled before read");
    for (const mock of Object.values(io)) expect(mock).not.toHaveBeenCalled();
  });
  it("documents and uses the actual default cloud provider", async () => {
    expect(readImageTool.description).toContain("default: Anthropic");
    expect((await readImageTool.execute({ path: "local.png" })).provider).toBe("anthropic");
    expect(io.anthropic).toHaveBeenCalledTimes(1);
  });
  it.each(["file-symlink", "directory-symlink", "hardlink"])(
    "rejects outside bytes via %s before SDK access",
    async (kind) => {
      const outside = path.join(temporary, "outside");
      await fs.mkdir(outside);
      const sentinel = path.join(outside, "secret.png");
      await fs.writeFile(sentinel, "private bytes");
      let selected = "escape.png";
      if (kind === "directory-symlink") {
        await fs.symlink(outside, path.join(root, "linked"));
        selected = "linked/secret.png";
      } else if (kind === "file-symlink") await fs.symlink(sentinel, path.join(root, selected));
      else await fs.link(sentinel, path.join(root, selected));
      await expect(readImageTool.execute({ path: selected })).rejects.toThrow();
      expect(await fs.readFile(sentinel, "utf8")).toBe("private bytes");
      for (const mock of Object.values(io)) expect(mock).not.toHaveBeenCalled();
    },
  );
  it("rejects oversized and nonregular files before cloud calls", async () => {
    const large = path.join(root, "large.png");
    const handle = await fs.open(large, "w");
    await handle.truncate(21 * 1024 * 1024);
    await handle.close();
    await fs.mkdir(path.join(root, "folder.png"));
    await expect(readImageTool.execute({ path: "large.png" })).rejects.toThrow(/large/);
    await expect(readImageTool.execute({ path: "folder.png" })).rejects.toThrow(/regular/);
    expect(io.anthropic).not.toHaveBeenCalled();
  });
  it("reports missing credentials and provider failures without inventing analysis", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "");
    await expect(readImageTool.execute({ path: "local.png", provider: "gemini" })).rejects.toThrow(
      /environment variable required/,
    );
    expect(io.gemini).not.toHaveBeenCalled();
    io.anthropic.mockRejectedValue(new Error("provider unavailable"));
    await expect(readImageTool.execute({ path: "local.png" })).rejects.toThrow(
      /Image analysis failed/,
    );
  });
});
