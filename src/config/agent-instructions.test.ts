import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("agent instruction compatibility", () => {
  it("uses AGENTS.md as a lightweight pointer to CLAUDE.md", async () => {
    const agentsPath = path.resolve("AGENTS.md");
    const agents = await readFile(agentsPath, "utf-8");

    expect(agents).toContain("[`CLAUDE.md`](CLAUDE.md)");
    expect(agents).toContain("Do not duplicate the full contents of `CLAUDE.md`");
    expect(agents.length).toBeLessThan(1200);
  });
});
