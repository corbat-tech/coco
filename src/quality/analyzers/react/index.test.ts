/**
 * Tests for React Quality Analyzers
 */

import { describe, it, expect } from "vitest";
import {
  ReactComponentAnalyzer,
  ReactA11yAnalyzer,
  ReactHookAnalyzer,
  registerReactAnalyzers,
} from "./index.js";
import { DimensionRegistry } from "../../dimension-registry.js";

// ──────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────────────

const GOOD_COMPONENT = `
import React, { useState, useCallback } from 'react';

interface UserCardProps {
  /** User name to display */
  name: string;
  /** User email */
  email: string;
  /** Callback when card is clicked */
  onClick?: () => void;
}

/**
 * Displays a user card with name and email.
 */
export function UserCard({ name, email, onClick }: UserCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      role="button"
      aria-label={\`User card for \${name}\`}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <h2>{name}</h2>
      <p>{email}</p>
      {isExpanded && (
        <button onClick={handleToggle} aria-expanded={isExpanded}>
          Show less
        </button>
      )}
    </div>
  );
}
`;

const BAD_COMPONENT = `
import React from 'react';

export function BadComponent(props) {
  return (
    <div onClick={props.onClick}>
      <img src={props.image} />
      <a onClick={() => console.log('clicked')}>Click me</a>
      <div onClick={props.onSelect} style={{cursor: 'pointer'}}>
        Item
      </div>
      {props.items.map((item) => (
        <div>{item.name}</div>
      ))}
    </div>
  );
}
`;

const HOOK_VIOLATIONS = `
import { useState, useEffect } from 'react';

function useDataFetcher(url) {
  const [data, setData] = useState(null);

  // Missing dependency array in useEffect
  useEffect(() => {
    fetch(url).then(r => r.json()).then(setData);
  });

  // useEffect inside conditional
  if (data) {
    useEffect(() => {
      console.log('data loaded');
    }, [data]);
  }

  return data;
}
`;

const GOOD_HOOKS = `
import { useState, useEffect, useCallback } from 'react';

export function useDataFetcher(url: string) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(url);
      const json = await response.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading };
}
`;

// ──────────────────────────────────────────────────────────────────────────────
// ReactComponentAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReactComponentAnalyzer", () => {
  it("should return high score for well-structured component", async () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserCard.tsx", content: GOOD_COMPONENT },
    ]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should detect missing key prop in list rendering", async () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    const missingKey = result.issues.find((i) =>
      i.rule.toLowerCase().includes("key"),
    );
    expect(missingKey).toBeDefined();
  });

  it("should return lower score for bad component", async () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    expect(result.score).toBeLessThan(80);
  });

  it("should handle empty file list", async () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it("should count components", async () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserCard.tsx", content: GOOD_COMPONENT },
    ]);
    expect(result.totalComponents).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ReactA11yAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReactA11yAnalyzer", () => {
  it("should return high score for accessible component", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "UserCard.tsx", content: GOOD_COMPONENT },
    ]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should detect missing alt text on images", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    const altViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("alt"),
    );
    expect(altViolation).toBeDefined();
  });

  it("should detect non-interactive elements with onClick", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    const clickViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("click") ||
      v.rule.toLowerCase().includes("interactive"),
    );
    expect(clickViolation).toBeDefined();
  });

  it("should detect missing href on anchor tags used as buttons", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    const hrefViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("href") ||
      v.rule.toLowerCase().includes("anchor"),
    );
    expect(hrefViolation).toBeDefined();
  });

  it("should return lower score for inaccessible component", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "BadComponent.tsx", content: BAD_COMPONENT },
    ]);
    expect(result.score).toBeLessThan(80);
  });

  it("should handle empty file list", async () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ReactHookAnalyzer tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReactHookAnalyzer", () => {
  it("should return high score for well-written hooks", async () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "useDataFetcher.ts", content: GOOD_HOOKS },
    ]);
    expect(result.score).toBeGreaterThan(70);
  });

  it("should detect missing useEffect dependency array", async () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "useDataFetcher.ts", content: HOOK_VIOLATIONS },
    ]);
    const depsViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("dep") ||
      v.rule.toLowerCase().includes("effect"),
    );
    expect(depsViolation).toBeDefined();
  });

  it("should detect hooks called inside conditionals", async () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "useDataFetcher.ts", content: HOOK_VIOLATIONS },
    ]);
    const conditionalViolation = result.violations.find((v) =>
      v.rule.toLowerCase().includes("conditional") ||
      v.rule.toLowerCase().includes("rule"),
    );
    expect(conditionalViolation).toBeDefined();
  });

  it("should return lower score for hook violations", async () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = await analyzer.analyzeContent([
      { path: "useDataFetcher.ts", content: HOOK_VIOLATIONS },
    ]);
    expect(result.score).toBeLessThan(80);
  });

  it("should handle empty file list", async () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = await analyzer.analyzeContent([]);
    expect(result.score).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// registerReactAnalyzers tests
// ──────────────────────────────────────────────────────────────────────────────

describe("registerReactAnalyzers", () => {
  it("should register analyzers for react-typescript language", () => {
    const registry = new DimensionRegistry();
    registerReactAnalyzers(registry, "/project");
    expect(registry.hasAnalyzers("react-typescript")).toBe(true);
  });

  it("should register analyzers for react-javascript language", () => {
    const registry = new DimensionRegistry();
    registerReactAnalyzers(registry, "/project");
    expect(registry.hasAnalyzers("react-javascript")).toBe(true);
  });

  it("should register analyzers for correctness, style, and robustness dimensions", () => {
    const registry = new DimensionRegistry();
    registerReactAnalyzers(registry, "/project");

    const reactAnalyzers = registry.getAnalyzers("react-typescript");
    const dimensionIds = new Set(reactAnalyzers.map((a) => a.dimensionId));

    // React-specific dimensions
    expect(dimensionIds).toContain("correctness"); // hook rules
    expect(dimensionIds).toContain("robustness");  // a11y
    expect(dimensionIds).toContain("style");        // component quality
  });

  it("should not register analyzers for java or python", () => {
    const registry = new DimensionRegistry();
    registerReactAnalyzers(registry, "/project");
    expect(registry.getAnalyzers("java")).toHaveLength(0);
    expect(registry.getAnalyzers("python")).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Post-refactor smoke test: all 3 analyzers still produce results via analyzeContent
// Verifies that extracting shared loadFiles/findReactFiles to module level did not break
// any analyzer's analyzeContent method.
// ──────────────────────────────────────────────────────────────────────────────

describe("React analyzers — post-refactor smoke test (shared helpers)", () => {
  const sampleFiles = [{ path: "Sample.tsx", content: BAD_COMPONENT }];

  it("ReactComponentAnalyzer.analyzeContent still returns a result with score and issues", () => {
    const analyzer = new ReactComponentAnalyzer("/project");
    const result = analyzer.analyzeContent(sampleFiles);
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.totalComponents).toBe("number");
  });

  it("ReactA11yAnalyzer.analyzeContent still returns a result with score and violations", () => {
    const analyzer = new ReactA11yAnalyzer("/project");
    const result = analyzer.analyzeContent(sampleFiles);
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.violations)).toBe(true);
  });

  it("ReactHookAnalyzer.analyzeContent still returns a result with score and violations", () => {
    const analyzer = new ReactHookAnalyzer("/project");
    const result = analyzer.analyzeContent([{ path: "useHook.ts", content: HOOK_VIOLATIONS }]);
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
