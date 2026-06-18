import { describe, expect, it } from "vitest";
import { getAgentMode, isAgentMode, listAgentModes } from "./modes.js";

describe("agent modes", () => {
  it("defines the expected modern workflow modes", () => {
    expect(listAgentModes().map((mode) => mode.id)).toEqual([
      "ask",
      "plan",
      "build",
      "debug",
      "review",
      "architect",
    ]);
  });

  it("keeps read-only modes separate from mutating modes", () => {
    expect(getAgentMode("ask").readOnly).toBe(true);
    expect(getAgentMode("plan").readOnly).toBe(true);
    expect(getAgentMode("review").readOnly).toBe(true);
    expect(getAgentMode("build").readOnly).toBe(false);
    expect(getAgentMode("debug").requiresVerification).toBe(true);
  });

  it("validates mode IDs", () => {
    expect(isAgentMode("architect")).toBe(true);
    expect(isAgentMode("ship")).toBe(false);
  });
});
