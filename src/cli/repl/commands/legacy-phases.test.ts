import { describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import { buildCommand } from "./build.js";
import { outputCommand } from "./output.js";
import type { ReplSession } from "../types.js";

vi.mock("@clack/prompts", () => ({ log: { warning: vi.fn(), info: vi.fn() } }));
vi.mock("../trust-store.js", () => ({
  createTrustStore: () => {
    throw new Error("Unavailable commands must not load trust or request write access");
  },
}));

describe("unavailable REPL phase commands", () => {
  it.each([buildCommand, outputCommand])(
    "$name reports unavailable without seeking write access",
    async (command) => {
      vi.clearAllMocks();
      const session = { projectPath: "/untrusted-project" } as ReplSession;
      expect(await command.execute([], session)).toBe(false);
      expect(p.log.warning).toHaveBeenCalledWith(expect.stringContaining("not implemented"));
      expect(p.log.info).not.toHaveBeenCalledWith(expect.stringMatching(/coco (build|resume)/));
    },
  );
});
