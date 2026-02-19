/**
 * Language Detection Engine
 *
 * Detects programming languages from file extensions and content.
 * Powers the Dimension Registry plugin architecture — quality analyzers
 * are loaded based on the detected language.
 */

import * as path from "node:path";

/**
 * Supported language identifiers
 */
export type LanguageId =
  | "typescript"
  | "javascript"
  | "react-typescript"
  | "react-javascript"
  | "java"
  | "python"
  | "go"
  | "rust"
  | "unknown";

/**
 * Language detection result with confidence and evidence
 */
export interface LanguageDetectionResult {
  /** Detected language */
  language: LanguageId;
  /** Confidence score 0-1 (higher = more certain) */
  confidence: number;
  /** Evidence strings explaining why this language was detected */
  evidence: string[];
}

/**
 * Map of file extension → language ID
 */
const EXTENSION_MAP: Record<string, LanguageId> = {
  ".ts": "typescript",
  ".d.ts": "typescript",
  ".tsx": "react-typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "react-javascript",
  ".java": "java",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

/**
 * Patterns that indicate React usage in .ts/.js files
 * (without the .tsx/.jsx extension)
 */
const REACT_CONTENT_PATTERNS = [
  /import\s+React\b/,
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom['"]/,
  /<[A-Z][A-Za-z]*[\s/>]/, // JSX component usage
  /React\.createElement/,
  /useEffect|useState|useRef|useCallback|useMemo|useContext/,
];

/**
 * Detect the language of a single file.
 * Uses file extension first; falls back to content analysis for .ts/.js.
 *
 * @param filePath - Path to the file (used for extension detection)
 * @param content - Optional file content for deeper analysis
 * @returns Detected language ID
 */
export function detectLanguage(filePath: string, content?: string): LanguageId {
  if (!filePath) return "unknown";

  const ext = getFileExtension(filePath);
  const langByExt = EXTENSION_MAP[ext];

  if (!langByExt) return "unknown";

  // For .ts and .js files, check content for React usage
  if (content && (langByExt === "typescript" || langByExt === "javascript")) {
    if (hasReactContent(content)) {
      return langByExt === "typescript" ? "react-typescript" : "react-javascript";
    }
  }

  return langByExt;
}

/**
 * Check if a file is a React component.
 * Returns true if the file extension is .tsx/.jsx,
 * OR if it's a .ts/.js file that contains React patterns.
 *
 * Strict: non-JS/TS files (e.g., .java) always return false.
 *
 * @param filePath - Path to the file
 * @param content - Optional file content for deeper analysis
 */
export function isReactFile(filePath: string, content?: string): boolean {
  if (!filePath) return false;

  const ext = getFileExtension(filePath);

  // .tsx and .jsx are always React
  if (ext === ".tsx" || ext === ".jsx") return true;

  // For .ts and .js, check content
  if ((ext === ".ts" || ext === ".js") && content) {
    return hasReactContent(content);
  }

  return false;
}

/**
 * Detect the primary language of a project from its file list.
 * Uses file extension distribution to determine the dominant language.
 *
 * @param files - Array of file paths in the project
 * @returns Language detection result with confidence and evidence
 */
export function detectProjectLanguage(files: string[]): LanguageDetectionResult {
  if (!files.length) {
    return { language: "unknown", confidence: 0, evidence: [] };
  }

  // Count source files by language
  const counts = new Map<LanguageId, number>();
  let totalSourceFiles = 0;

  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang !== "unknown") {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
      totalSourceFiles++;
    }
  }

  if (totalSourceFiles === 0) {
    return { language: "unknown", confidence: 0, evidence: [] };
  }

  // Find dominant language
  let maxCount = 0;
  let dominant: LanguageId = "unknown";

  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = lang;
    }
  }

  const confidence = maxCount / totalSourceFiles;
  const evidence = buildEvidence(dominant, counts, totalSourceFiles, files);

  // Merge react-typescript/react-javascript under parent if needed
  // If there are both .tsx and .ts files, prefer react-typescript
  const tsxCount = counts.get("react-typescript") ?? 0;
  const tsCount = counts.get("typescript") ?? 0;
  if (dominant === "typescript" && tsxCount > 0 && tsxCount >= tsCount * 0.3) {
    return {
      language: "react-typescript",
      confidence,
      evidence: [...evidence, `${tsxCount} React (.tsx) files detected`],
    };
  }

  return { language: dominant, confidence, evidence };
}

// ──────────────────────────────────────────────────────────────────────────────
// Private helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get the file extension, handling double extensions like `.d.ts`
 */
function getFileExtension(filePath: string): string {
  const base = path.basename(filePath);

  // Handle special double-extension cases
  if (base.endsWith(".d.ts")) return ".d.ts";

  return path.extname(filePath).toLowerCase();
}

/**
 * Check if file content contains React patterns
 */
function hasReactContent(content: string): boolean {
  return REACT_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Build human-readable evidence strings for the detection result
 */
function buildEvidence(
  dominant: LanguageId,
  counts: Map<LanguageId, number>,
  totalSourceFiles: number,
  files: string[],
): string[] {
  const evidence: string[] = [];
  const dominantCount = counts.get(dominant) ?? 0;

  evidence.push(
    `${dominantCount} of ${totalSourceFiles} source files are ${dominant}`,
  );

  // Add project configuration file evidence
  const configFiles = ["tsconfig.json", "pom.xml", "build.gradle", "Cargo.toml", "go.mod"];
  for (const cfg of configFiles) {
    if (files.some((f) => path.basename(f) === cfg)) {
      evidence.push(`Found ${cfg}`);
    }
  }

  return evidence;
}
