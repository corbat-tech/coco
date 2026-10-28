import { describe, expect, it } from "vitest";
import { getAgentProfile, listAgentProfiles, resolveAgentProfile } from "./agent-profiles.js";
import { AGENT_TYPES } from "./agent-type.js";
import { getAgentConfig } from "../cli/repl/agents/prompts.js";
import { AGENT_ROLES } from "../agents/executor.js";

describe("distributed specialist profiles", () => {
  it("ships each existing profile with bounded instructions and a compatible CLI adapter", () => {
    expect(listAgentProfiles().map((p) => p.id)).toEqual([...AGENT_TYPES]);
    for (const profile of listAgentProfiles()) {
      expect(getAgentConfig(profile.id)).toMatchObject({
        type: profile.id,
        role: profile.role,
        tools: profile.allowedTools,
        systemPrompt: profile.instructions,
      });
      expect(profile.maxTurns).toBeGreaterThan(0);
      expect(profile.whenToUse).toBeTruthy();
      expect(profile.whenNotToUse).toBeTruthy();
      expect(profile.instructions).not.toMatch(
        /TypeScript ESM only|one assertion|80%|corbat-coco/i,
      );
    }
  });
  it("keeps strict user selection separate from legacy fallback and agrees on coder", () => {
    expect(resolveAgentProfile("@coder")).toBe("debug");
    expect(resolveAgentProfile("@editor")).toBe("refactor");
    expect(resolveAgentProfile("provider-debugger")).toBe("debug");
    expect(resolveAgentProfile("unknown")).toBeUndefined();
    expect(resolveAgentProfile("constructor")).toBeUndefined();
    expect(AGENT_ROLES.coder?.systemPrompt).toBe(getAgentProfile("debug").instructions);
  });
  it("returns isolated profiles and rejects nonexistent profiles", () => {
    const profile = getAgentProfile("explore");
    profile.allowedTools.push("write_file");
    expect(getAgentProfile("explore").allowedTools).not.toContain("write_file");
    expect(getAgentProfile("explore").allowedTools).not.toContain("bash_exec");
    expect(() => getAgentProfile("missing" as never)).toThrow("Unknown agent profile");
  });
});
