/**
 * Tests for the changelog module
 */

import { describe, it, expect } from "vitest";
import { generateChangelogEntries } from "./changelog.js";

describe("generateChangelogEntries", () => {
  it("strips conventional commit prefixes", () => {
    const entries = generateChangelogEntries([
      "feat: add new api endpoint",
      "fix: resolve auth bug",
      "docs: update readme",
    ]);
    expect(entries).toEqual(["Add new api endpoint", "Resolve auth bug", "Update readme"]);
  });

  it("strips scoped conventional commit prefixes", () => {
    const entries = generateChangelogEntries([
      "feat(auth): add oauth support",
      "fix(api): fix null pointer",
    ]);
    expect(entries).toEqual(["Add oauth support", "Fix null pointer"]);
  });

  it("capitalizes first letter", () => {
    const entries = generateChangelogEntries(["lowercase message"]);
    expect(entries).toEqual(["Lowercase message"]);
  });

  it("filters empty entries", () => {
    const entries = generateChangelogEntries(["feat:", "", "fix: valid"]);
    expect(entries).toEqual(["Valid"]);
  });

  it("handles non-conventional commits", () => {
    const entries = generateChangelogEntries(["Update the docs", "Small fix"]);
    expect(entries).toEqual(["Update the docs", "Small fix"]);
  });

  it("handles empty array", () => {
    expect(generateChangelogEntries([])).toEqual([]);
  });

  it("strips breaking change prefix", () => {
    const entries = generateChangelogEntries(["feat!: remove old api"]);
    expect(entries).toEqual(["Remove old api"]);
  });
});
