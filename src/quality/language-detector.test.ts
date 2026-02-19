/**
 * Tests for Language Detection Engine
 */

import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  detectProjectLanguage,
  isReactFile,
  type LanguageId,
} from "./language-detector.js";

describe("detectLanguage", () => {
  describe("TypeScript files", () => {
    it("should detect .ts files as typescript", () => {
      expect(detectLanguage("src/utils.ts")).toBe("typescript");
    });

    it("should detect .d.ts files as typescript", () => {
      expect(detectLanguage("src/types.d.ts")).toBe("typescript");
    });

    it("should detect .tsx files as react-typescript", () => {
      expect(detectLanguage("src/App.tsx")).toBe("react-typescript");
    });
  });

  describe("JavaScript files", () => {
    it("should detect .js files as javascript", () => {
      expect(detectLanguage("src/utils.js")).toBe("javascript");
    });

    it("should detect .mjs files as javascript", () => {
      expect(detectLanguage("src/module.mjs")).toBe("javascript");
    });

    it("should detect .cjs files as javascript", () => {
      expect(detectLanguage("src/module.cjs")).toBe("javascript");
    });

    it("should detect .jsx files as react-javascript", () => {
      expect(detectLanguage("src/App.jsx")).toBe("react-javascript");
    });
  });

  describe("Java files", () => {
    it("should detect .java files as java", () => {
      expect(detectLanguage("src/main/java/App.java")).toBe("java");
    });
  });

  describe("Python files", () => {
    it("should detect .py files as python", () => {
      expect(detectLanguage("scripts/run.py")).toBe("python");
    });
  });

  describe("Go files", () => {
    it("should detect .go files as go", () => {
      expect(detectLanguage("cmd/main.go")).toBe("go");
    });
  });

  describe("Rust files", () => {
    it("should detect .rs files as rust", () => {
      expect(detectLanguage("src/main.rs")).toBe("rust");
    });
  });

  describe("Unknown files", () => {
    it("should return unknown for unrecognized extensions", () => {
      expect(detectLanguage("config.yaml")).toBe("unknown");
    });

    it("should return unknown for files without extension", () => {
      expect(detectLanguage("Makefile")).toBe("unknown");
    });

    it("should return unknown for empty string", () => {
      expect(detectLanguage("")).toBe("unknown");
    });
  });

  describe("content-based detection", () => {
    it("should detect React content in .ts files as react-typescript", () => {
      const content = `
        import React from 'react';
        import { useState } from 'react';

        export function MyComponent() {
          const [count, setCount] = useState(0);
          return <div>{count}</div>;
        }
      `;
      expect(detectLanguage("src/component.ts", content)).toBe("react-typescript");
    });

    it("should detect React content in .js files as react-javascript", () => {
      const content = `
        import React from 'react';
        function App() { return <div>Hello</div>; }
        export default App;
      `;
      expect(detectLanguage("src/App.js", content)).toBe("react-javascript");
    });

    it("should not override .java files based on content", () => {
      const content = `import react from 'react';`;
      expect(detectLanguage("src/App.java", content)).toBe("java");
    });
  });
});

describe("detectProjectLanguage", () => {
  it("should detect TypeScript project from .ts files", () => {
    const files = [
      "src/index.ts",
      "src/utils.ts",
      "src/types.ts",
      "package.json",
      "tsconfig.json",
    ];
    const result = detectProjectLanguage(files);
    expect(result.language).toBe("typescript");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect React project from .tsx files", () => {
    const files = [
      "src/App.tsx",
      "src/index.tsx",
      "src/components/Button.tsx",
      "package.json",
    ];
    const result = detectProjectLanguage(files);
    expect(result.language).toBe("react-typescript");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect Java project from .java files", () => {
    const files = [
      "src/main/java/com/example/App.java",
      "src/main/java/com/example/Service.java",
      "pom.xml",
    ];
    const result = detectProjectLanguage(files);
    expect(result.language).toBe("java");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect JavaScript project from .js files", () => {
    const files = [
      "src/index.js",
      "src/utils.js",
      "package.json",
    ];
    const result = detectProjectLanguage(files);
    expect(result.language).toBe("javascript");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should return unknown for empty file list", () => {
    const result = detectProjectLanguage([]);
    expect(result.language).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("should return unknown for non-source files", () => {
    const result = detectProjectLanguage(["README.md", "Makefile", ".gitignore"]);
    expect(result.language).toBe("unknown");
  });

  it("should include evidence in result", () => {
    const files = ["src/index.ts", "src/utils.ts"];
    const result = detectProjectLanguage(files);
    expect(result.evidence).toBeDefined();
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

describe("isReactFile", () => {
  it("should return true for .tsx files", () => {
    expect(isReactFile("src/App.tsx")).toBe(true);
  });

  it("should return true for .jsx files", () => {
    expect(isReactFile("src/App.jsx")).toBe(true);
  });

  it("should return false for .ts files", () => {
    expect(isReactFile("src/utils.ts")).toBe(false);
  });

  it("should return true for .ts files with React content", () => {
    const content = `import React from 'react'; export function Comp() { return <div/>; }`;
    expect(isReactFile("src/utils.ts", content)).toBe(true);
  });

  it("should return false for .java files regardless of content", () => {
    const content = `import react from 'react';`;
    expect(isReactFile("src/App.java", content)).toBe(false);
  });
});

describe("LanguageId type coverage", () => {
  it("should have all expected language IDs", () => {
    const languages: LanguageId[] = [
      "typescript",
      "javascript",
      "react-typescript",
      "react-javascript",
      "java",
      "python",
      "go",
      "rust",
      "unknown",
    ];
    expect(languages).toHaveLength(9);
  });
});
