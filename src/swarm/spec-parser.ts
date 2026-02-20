/**
 * Swarm Spec Parser
 *
 * Parses YAML or Markdown specification files into a SwarmSpec.
 */

/**
 * Feature with acceptance criteria and dependency ordering
 */
export interface SwarmFeature {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[]; // other feature ids
  priority: "high" | "medium" | "low";
}

/**
 * Technology stack definition
 */
export interface SwarmTechStack {
  language: string;
  framework?: string;
  database?: string;
  testing?: string;
}

/**
 * Full swarm specification parsed from a spec file
 */
export interface SwarmSpec {
  projectName: string;
  description: string;
  techStack: SwarmTechStack;
  features: SwarmFeature[];
  qualityConfig: {
    minScore: number;
    maxIterations: number;
    minCoverage: number;
  };
  /** Raw file content */
  rawContent: string;
}

/**
 * Parse a spec file (YAML or Markdown) into a SwarmSpec.
 *
 * - `.yaml` / `.yml`: parsed as full YAML document
 * - `.md` / `.markdown`: parsed by extracting ## Feature: sections
 * - Other: attempt YAML first, fallback to Markdown
 */
export async function parseSwarmSpec(filePath: string): Promise<SwarmSpec> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const rawContent = await fs.readFile(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return parseYamlSpec(rawContent, filePath);
  }

  if (ext === ".md" || ext === ".markdown") {
    return parseMarkdownSpec(rawContent);
  }

  // Unknown extension — sniff content
  const trimmed = rawContent.trimStart();
  if (trimmed.startsWith("---") || trimmed.startsWith("project") || trimmed.startsWith("name:")) {
    try {
      return parseYamlSpec(rawContent, filePath);
    } catch {
      // fall through to markdown
    }
  }

  return parseMarkdownSpec(rawContent);
}

// ---------------------------------------------------------------------------
// YAML parsing (hand-rolled; no js-yaml dependency needed for simple docs)
// ---------------------------------------------------------------------------

function parseYamlSpec(content: string, _filePath: string): SwarmSpec {
  const data = simpleYamlParse(content);
  return buildSpec(data, content);
}

/**
 * Minimal YAML parser that handles the fields used in SwarmSpec.
 * Supports: string scalars, list items (- value), and nested objects via indentation.
 * Does NOT support anchors, complex types, or multiline strings.
 */
function simpleYamlParse(content: string): Record<string, unknown> {
  const lines = content
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .filter((l) => l.trim() !== "---");

  const result: Record<string, unknown> = {};
  parseYamlLines(lines, 0, result);
  return result;
}

/**
 * Recursively parse YAML lines into an object.
 * Returns the next unprocessed line index.
 */
function parseYamlLines(
  lines: string[],
  startIndex: number,
  target: Record<string, unknown>,
): number {
  let i = startIndex;
  const firstLine = lines[i];
  const baseIndent = firstLine !== undefined ? getIndent(firstLine) : 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    const trimmed = line.trim();

    if (trimmed === "" || trimmed === "---") {
      i++;
      continue;
    }

    // If we've de-dented back past our base, return to parent
    if (indent < baseIndent) {
      break;
    }

    if (trimmed.startsWith("- ")) {
      // This is a list item at this level — handled by parent
      break;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest !== "") {
      // Inline scalar or inline list
      target[key] = parseScalar(rest);
      i++;
    } else {
      // Nested block — peek next line
      i++;
      if (i >= lines.length) break;

      const nextLine = lines[i];
      if (nextLine === undefined) break;
      const nextTrimmed = nextLine.trim();

      if (nextTrimmed.startsWith("- ")) {
        // List block
        const items: unknown[] = [];
        while (i < lines.length) {
          const currentLine = lines[i];
          if (currentLine === undefined) break;
          if (!currentLine.trim().startsWith("- ")) break;

          const itemContent = currentLine.trim().slice(2);
          if (itemContent.includes(":")) {
            // Inline map item: "- key: value"
            const itemObj: Record<string, unknown> = {};
            parseYamlInlineMap(itemContent, itemObj);
            // Check if next lines are continuation of this map item (deeper indent)
            const itemIndent = getIndent(currentLine) + 2;
            i++;
            while (i < lines.length) {
              const subRawLine = lines[i];
              if (subRawLine === undefined) break;
              if (getIndent(subRawLine) < itemIndent) break;
              const subLine = subRawLine.trim();
              if (subLine.startsWith("- ")) break;
              const subColonIdx = subLine.indexOf(":");
              if (subColonIdx !== -1) {
                const subKey = subLine.slice(0, subColonIdx).trim();
                const subRest = subLine.slice(subColonIdx + 1).trim();
                if (subRest !== "") {
                  itemObj[subKey] = parseScalar(subRest);
                } else {
                  // nested list under this key
                  i++;
                  const subItems: unknown[] = [];
                  while (i < lines.length) {
                    const subListLine = lines[i];
                    if (subListLine === undefined) break;
                    if (!subListLine.trim().startsWith("- ")) break;
                    subItems.push(parseScalar(subListLine.trim().slice(2)));
                    i++;
                  }
                  itemObj[subKey] = subItems;
                  continue;
                }
              }
              i++;
            }
            items.push(itemObj);
          } else {
            items.push(parseScalar(itemContent));
            i++;
          }
        }
        target[key] = items;
      } else if (nextTrimmed !== "" && !nextTrimmed.startsWith("---")) {
        // Nested object block
        const nested: Record<string, unknown> = {};
        i = parseYamlLines(lines, i, nested);
        target[key] = nested;
      }
    }
  }

  return i;
}

function parseYamlInlineMap(content: string, target: Record<string, unknown>): void {
  // Handle simple "key: value" pairs on a single line
  const colonIdx = content.indexOf(":");
  if (colonIdx !== -1) {
    const key = content.slice(0, colonIdx).trim();
    const value = content.slice(colonIdx + 1).trim();
    target[key] = parseScalar(value);
  }
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  // Inline list [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => parseScalar(s.trim()));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

function parseMarkdownSpec(content: string): SwarmSpec {
  const features: SwarmFeature[] = [];
  let projectName = "unnamed-project";
  let description = "";
  const techStack: SwarmTechStack = { language: "typescript" };
  const qualityConfig = { minScore: 85, maxIterations: 10, minCoverage: 80 };

  // Extract project name from # heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    const captured = h1Match[1];
    if (captured !== undefined) {
      projectName = captured.trim();
    }
  }

  // Extract description from first paragraph (after h1, before next heading)
  const descMatch = content.match(/^#\s+.+\n+([^#\n][^\n]*(?:\n[^#\n][^\n]*)*)/m);
  if (descMatch) {
    const captured = descMatch[1];
    if (captured !== undefined) {
      description = captured.trim();
    }
  }

  // Extract tech stack from ## Tech Stack or ## Technology section
  const techMatch = content.match(
    /##\s+(?:Tech Stack|Technology|Stack)\s*\n([\s\S]*?)(?=\n##|\n$|$)/i,
  );
  if (techMatch) {
    const techLines = techMatch[1];
    if (techLines !== undefined) {
      const langMatch = techLines.match(/language[:\s]+([^\n]+)/i);
      if (langMatch) {
        const v = langMatch[1];
        if (v !== undefined) techStack.language = v.trim();
      }
      const fwMatch = techLines.match(/framework[:\s]+([^\n]+)/i);
      if (fwMatch) {
        const v = fwMatch[1];
        if (v !== undefined) techStack.framework = v.trim();
      }
      const dbMatch = techLines.match(/database[:\s]+([^\n]+)/i);
      if (dbMatch) {
        const v = dbMatch[1];
        if (v !== undefined) techStack.database = v.trim();
      }
      const testMatch = techLines.match(/testing[:\s]+([^\n]+)/i);
      if (testMatch) {
        const v = testMatch[1];
        if (v !== undefined) techStack.testing = v.trim();
      }
    }
  }

  // Extract quality config
  const qualMatch = content.match(
    /##\s+(?:Quality|Config|Quality Config)\s*\n([\s\S]*?)(?=\n##|\n$|$)/i,
  );
  if (qualMatch) {
    const qLines = qualMatch[1];
    if (qLines !== undefined) {
      const scoreMatch = qLines.match(/min[_-]?score[:\s]+(\d+)/i);
      if (scoreMatch) {
        const v = scoreMatch[1];
        if (v !== undefined) qualityConfig.minScore = parseInt(v, 10);
      }
      const covMatch = qLines.match(/min[_-]?coverage[:\s]+(\d+)/i);
      if (covMatch) {
        const v = covMatch[1];
        if (v !== undefined) qualityConfig.minCoverage = parseInt(v, 10);
      }
      const iterMatch = qLines.match(/max[_-]?iterations[:\s]+(\d+)/i);
      if (iterMatch) {
        const v = iterMatch[1];
        if (v !== undefined) qualityConfig.maxIterations = parseInt(v, 10);
      }
    }
  }

  // Extract features from ## Feature: Name sections
  const featurePattern = /##\s+Feature:\s*(.+)\n([\s\S]*?)(?=\n##\s+Feature:|\n##\s+[^F]|$)/gi;
  let featureIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = featurePattern.exec(content)) !== null) {
    const featureNameRaw = match[1];
    const featureBodyRaw = match[2];
    if (featureNameRaw === undefined || featureBodyRaw === undefined) continue;

    const featureName = featureNameRaw.trim();
    const featureBody = featureBodyRaw;
    featureIdx++;
    const featureId = `f-${featureIdx}`;

    // Extract description
    const bodyDescMatch = featureBody.match(
      /^([^#\n][^\n]*(?:\n[^#\n][^\n]*)*?)(?=\n###|\n$|$)/m,
    );
    const featureDesc =
      bodyDescMatch && bodyDescMatch[1] !== undefined
        ? bodyDescMatch[1].trim()
        : featureName;

    // Extract acceptance criteria from ### Acceptance Criteria
    const acMatch = featureBody.match(
      /###\s+Acceptance Criteria\s*\n([\s\S]*?)(?=\n###|\n$|$)/i,
    );
    const acceptanceCriteria: string[] = [];
    if (acMatch) {
      const acContent = acMatch[1];
      if (acContent !== undefined) {
        const listItems = acContent.match(/^[-*]\s+(.+)$/gm);
        if (listItems) {
          for (const item of listItems) {
            acceptanceCriteria.push(item.replace(/^[-*]\s+/, "").trim());
          }
        }
      }
    }

    // Extract dependencies
    const depsMatch = featureBody.match(/###\s+Dependencies\s*\n([\s\S]*?)(?=\n###|\n$|$)/i);
    const dependencies: string[] = [];
    if (depsMatch) {
      const depsContent = depsMatch[1];
      if (depsContent !== undefined) {
        const depItems = depsContent.match(/^[-*]\s+(.+)$/gm);
        if (depItems) {
          for (const item of depItems) {
            dependencies.push(item.replace(/^[-*]\s+/, "").trim());
          }
        }
      }
    }

    // Extract priority
    const prioMatch = featureBody.match(/priority[:\s]+(high|medium|low)/i);
    const priority = (prioMatch?.[1]?.toLowerCase() ?? "medium") as "high" | "medium" | "low";

    features.push({
      id: featureId,
      name: featureName,
      description: featureDesc,
      acceptanceCriteria,
      dependencies,
      priority,
    });
  }

  return {
    projectName,
    description,
    techStack,
    features,
    qualityConfig,
    rawContent: content,
  };
}

// ---------------------------------------------------------------------------
// Builder from parsed YAML data
// ---------------------------------------------------------------------------

function buildSpec(data: Record<string, unknown>, rawContent: string): SwarmSpec {
  const projectName =
    (data["projectName"] as string) ||
    (data["name"] as string) ||
    (data["project"] as string) ||
    "unnamed-project";

  const description = (data["description"] as string) || "";

  // Tech stack
  const rawTech =
    (data["techStack"] as Record<string, unknown>) ||
    (data["tech_stack"] as Record<string, unknown>) ||
    (data["tech"] as Record<string, unknown>) ||
    {};
  const techStack: SwarmTechStack = {
    language: (rawTech["language"] as string) || "typescript",
    framework: rawTech["framework"] as string | undefined,
    database: rawTech["database"] as string | undefined,
    testing: rawTech["testing"] as string | undefined,
  };

  // Quality config
  const rawQuality =
    (data["qualityConfig"] as Record<string, unknown>) ||
    (data["quality_config"] as Record<string, unknown>) ||
    (data["quality"] as Record<string, unknown>) ||
    {};
  const qualityConfig = {
    minScore:
      typeof rawQuality["minScore"] === "number"
        ? rawQuality["minScore"]
        : typeof rawQuality["min_score"] === "number"
          ? (rawQuality["min_score"] as number)
          : 85,
    maxIterations:
      typeof rawQuality["maxIterations"] === "number"
        ? rawQuality["maxIterations"]
        : typeof rawQuality["max_iterations"] === "number"
          ? (rawQuality["max_iterations"] as number)
          : 10,
    minCoverage:
      typeof rawQuality["minCoverage"] === "number"
        ? rawQuality["minCoverage"]
        : typeof rawQuality["min_coverage"] === "number"
          ? (rawQuality["min_coverage"] as number)
          : 80,
  };

  // Features
  const rawFeatures = (data["features"] as Array<Record<string, unknown>>) || [];
  const features: SwarmFeature[] = rawFeatures.map((f, idx) => {
    const rawAC =
      (f["acceptanceCriteria"] as unknown[]) || (f["acceptance_criteria"] as unknown[]) || [];
    const rawDeps = (f["dependencies"] as unknown[]) || [];
    const priority = ((f["priority"] as string) || "medium") as "high" | "medium" | "low";

    return {
      id: (f["id"] as string) || `f-${idx + 1}`,
      name: (f["name"] as string) || `Feature ${idx + 1}`,
      description: (f["description"] as string) || "",
      acceptanceCriteria: rawAC.map((ac) => String(ac)),
      dependencies: rawDeps.map((d) => String(d)),
      priority,
    };
  });

  validateSpec({ projectName, description, techStack, features, qualityConfig, rawContent });

  return { projectName, description, techStack, features, qualityConfig, rawContent };
}

function validateSpec(spec: SwarmSpec): void {
  if (!spec.projectName || spec.projectName === "unnamed-project") {
    // Non-fatal — just a warning-level concern, spec is still usable
  }
  if (spec.features.length === 0) {
    throw new Error(
      `Spec file has no features. Ensure features are defined under a "features:" key (YAML) or "## Feature: Name" sections (Markdown).`,
    );
  }
}
