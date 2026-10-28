import { describe, expect, it } from "vitest";
import { decideDelegation, parseDelegationIntent } from "./delegation-policy.js";

describe("proportionate delegation policy", () => {
  it.each([
    "Fix a typo",
    "Corrige el timeout",
    'Explain the log: "use agents"',
    "```use agents``` explain this",
  ])("keeps simple work direct: %s", (message) => {
    expect(decideDelegation({ message, mode: "auto" }).strategy).toBe("direct");
  });
  it.each(["sin agentes", "hazlo tú solo", "do not delegate", "without agents"])(
    "respects explicit refusal: %s",
    (message) => {
      expect(parseDelegationIntent(message)).toMatchObject({
        preference: "off",
        strategy: "direct",
      });
    },
  );
  it("honors host and configured ceilings even on explicit requests", () => {
    expect(
      decideDelegation({ message: "Use a security specialist", hostEnabled: false }).strategy,
    ).toBe("direct");
    expect(decideDelegation({ message: "@review inspect", mode: "off" }).strategy).toBe("direct");
    expect(decideDelegation({ message: "Revisa con un especialista" })).toMatchObject({
      strategy: "specialist",
      profile: "review",
      explicit: true,
    });
  });
  it.each([
    "Don't use agents",
    "Don't use agents; it's a small change",
    "sin especialistas",
    "no agents",
    "Do not use specialists",
  ])("negation wins even over an auto proposal: %s", (message) => {
    expect(
      decideDelegation({
        message,
        mode: "auto",
        proposal: {
          independentTasks: 2,
          hasDependencies: false,
          resourcesCompatible: true,
          acceptanceDefined: true,
          budgetAvailable: true,
        },
      }).strategy,
    ).toBe("direct");
  });
  it.each(["Explain `use agents`", "Explain 'use agents'", "> use agents\nExplain this example"])(
    "quoted instructions do not start workers: %s",
    (message) => {
      expect(parseDelegationIntent(message).explicit).toBe(false);
    },
  );
  it("does not treat a request for parallel work as a validated decomposition", () => {
    expect(decideDelegation({ message: "Use agents in parallel" })).toMatchObject({
      strategy: "direct",
      reason: expect.stringContaining("decomposition"),
    });
  });
  it("admits only bounded validated proposals in auto mode", () => {
    const proposal = {
      independentTasks: 2,
      hasDependencies: false,
      resourcesCompatible: true,
      acceptanceDefined: true,
      budgetAvailable: true,
    };
    expect(decideDelegation({ message: "Investigate", mode: "manual", proposal }).strategy).toBe(
      "direct",
    );
    expect(decideDelegation({ message: "Investigate", mode: "auto", proposal }).strategy).toBe(
      "parallel",
    );
    expect(
      decideDelegation({
        message: "Investigate",
        mode: "auto",
        proposal: { ...proposal, hasDependencies: true },
      }).strategy,
    ).toBe("sequential");
    expect(
      decideDelegation({
        message: "Investigate",
        mode: "auto",
        proposal: { ...proposal, resourcesCompatible: false },
      }).strategy,
    ).toBe("direct");
    for (const patch of [
      { budgetAvailable: false },
      { acceptanceDefined: false },
      { independentTasks: 0 },
      { independentTasks: NaN },
      { independentTasks: 1 },
    ]) {
      expect(
        decideDelegation({
          message: "Investigate",
          mode: "auto",
          proposal: { ...proposal, ...patch },
        }).strategy,
      ).toBe("direct");
    }
  });
  it("resolves profiles and ordered intent without changing reasoning settings", () => {
    expect(parseDelegationIntent("@architect design")).toMatchObject({
      profile: "architect",
      strategy: "specialist",
    });
    expect(parseDelegationIntent("Use agents first then implement").strategy).toBe("sequential");
    expect(parseDelegationIntent("Use a tester to verify").profile).toBe("test");
    expect(parseDelegationIntent("Use a debugger to fix it").profile).toBe("debug");
    expect(parseDelegationIntent("Use an agent to implement").profile).toBe("refactor");
    expect(parseDelegationIntent("Use an agent to investigate").profile).toBe("explore");
  });
});
