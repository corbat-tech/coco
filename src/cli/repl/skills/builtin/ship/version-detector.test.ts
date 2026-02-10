/**
 * Tests for the version detector module
 */

import { describe, it, expect } from "vitest";
import { bumpVersion, detectBumpFromCommits } from "./version-detector.js";

describe("bumpVersion", () => {
  it("bumps patch version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("bumps minor version and resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps major version and resets minor and patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("handles v-prefix", () => {
    expect(bumpVersion("v1.0.0", "patch")).toBe("1.0.1");
  });

  it("handles 0.x versions", () => {
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2");
  });

  it("handles versions with only major.minor", () => {
    expect(bumpVersion("1.2", "patch")).toBe("1.2.1");
  });
});

describe("detectBumpFromCommits", () => {
  it("detects patch from fix commits", () => {
    const messages = ["fix: resolve null pointer", "chore: update deps", "docs: update readme"];
    expect(detectBumpFromCommits(messages)).toBe("patch");
  });

  it("detects minor from feat commits", () => {
    const messages = ["feat: add new api endpoint", "fix: fix typo", "test: add unit tests"];
    expect(detectBumpFromCommits(messages)).toBe("minor");
  });

  it("detects major from BREAKING CHANGE", () => {
    const messages = ["feat: add new api", "fix: BREAKING CHANGE: removed old endpoint"];
    expect(detectBumpFromCommits(messages)).toBe("major");
  });

  it("detects major from exclamation mark syntax", () => {
    const messages = ["feat!: complete api redesign"];
    expect(detectBumpFromCommits(messages)).toBe("major");
  });

  it("detects major from scoped exclamation mark", () => {
    const messages = ["feat(api)!: remove v1 endpoints"];
    expect(detectBumpFromCommits(messages)).toBe("major");
  });

  it("defaults to patch for non-conventional commits", () => {
    const messages = ["update readme", "small fix"];
    expect(detectBumpFromCommits(messages)).toBe("patch");
  });

  it("handles empty array", () => {
    expect(detectBumpFromCommits([])).toBe("patch");
  });

  it("handles feature with scope", () => {
    const messages = ["feat(auth): add oauth support"];
    expect(detectBumpFromCommits(messages)).toBe("minor");
  });
});
