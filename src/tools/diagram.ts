/**
 * Diagram generation tool for Corbat-Coco
 * Generate Mermaid diagrams from code analysis or descriptions
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";

const fs = await import("node:fs/promises");
const path = await import("node:path");
const { glob } = await import("glob");

/**
 * Diagram output
 */
export interface DiagramOutput {
  diagram: string;
  format: string;
  type: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Parse TypeScript/JavaScript for class relationships
 */
async function parseClassRelationships(
  rootPath: string,
  include?: string,
): Promise<{
  classes: Array<{
    name: string;
    file: string;
    methods: string[];
    properties: string[];
    extends?: string;
    implements: string[];
  }>;
  interfaces: Array<{
    name: string;
    file: string;
    methods: string[];
  }>;
}> {
  const pattern = include ?? "**/*.{ts,tsx,js,jsx}";
  const files = await glob(pattern, {
    cwd: rootPath,
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/*.d.ts"],
    nodir: true,
  });

  const classes: Array<{
    name: string;
    file: string;
    methods: string[];
    properties: string[];
    extends?: string;
    implements: string[];
  }> = [];

  const interfaces: Array<{
    name: string;
    file: string;
    methods: string[];
  }> = [];

  for (const file of files.slice(0, 100)) {
    try {
      const content = await fs.readFile(path.join(rootPath, file), "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Class
        const classMatch = line.match(
          /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/,
        );
        if (classMatch) {
          const methods: string[] = [];
          const properties: string[] = [];
          const implementsList = classMatch[3]
            ? classMatch[3].split(",").map((s) => s.trim())
            : [];

          // Scan class body (basic)
          let braceCount = 0;
          let started = false;
          for (let j = i; j < lines.length && j < i + 100; j++) {
            const bodyLine = lines[j];
            if (!bodyLine) continue;
            if (bodyLine.includes("{")) {
              braceCount++;
              started = true;
            }
            if (bodyLine.includes("}")) braceCount--;
            if (started && braceCount === 0) break;

            // Method
            const methodMatch = bodyLine.match(
              /^\s+(?:public|private|protected|static|async|get|set)?\s*(?:async\s+)?(\w+)\s*\(/,
            );
            if (methodMatch && methodMatch[1] !== "constructor") {
              methods.push(methodMatch[1] ?? "");
            }

            // Property
            const propMatch = bodyLine.match(
              /^\s+(?:public|private|protected|readonly|static)?\s*(\w+)\s*[?:]?\s*:/,
            );
            if (propMatch && !bodyLine.includes("(")) {
              properties.push(propMatch[1] ?? "");
            }
          }

          classes.push({
            name: classMatch[1] ?? "",
            file,
            methods: methods.slice(0, 10),
            properties: properties.slice(0, 10),
            extends: classMatch[2],
            implements: implementsList,
          });
        }

        // Interface
        const ifaceMatch = line.match(
          /(?:export\s+)?interface\s+(\w+)/,
        );
        if (ifaceMatch) {
          const methods: string[] = [];
          let braceCount = 0;
          let started = false;

          for (let j = i; j < lines.length && j < i + 50; j++) {
            const bodyLine = lines[j];
            if (!bodyLine) continue;
            if (bodyLine.includes("{")) {
              braceCount++;
              started = true;
            }
            if (bodyLine.includes("}")) braceCount--;
            if (started && braceCount === 0) break;

            const methodMatch = bodyLine.match(/^\s+(\w+)\s*[?(]/);
            if (methodMatch) {
              methods.push(methodMatch[1] ?? "");
            }
          }

          interfaces.push({
            name: ifaceMatch[1] ?? "",
            file,
            methods: methods.slice(0, 10),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return { classes, interfaces };
}

/**
 * Generate class diagram in Mermaid
 */
async function generateClassDiagram(
  rootPath: string,
  include?: string,
): Promise<DiagramOutput> {
  const { classes, interfaces } = await parseClassRelationships(
    rootPath,
    include,
  );

  const lines: string[] = ["classDiagram"];
  let nodeCount = 0;
  let edgeCount = 0;

  // Add interfaces
  for (const iface of interfaces) {
    lines.push(`  class ${iface.name} {`);
    lines.push(`    <<interface>>`);
    for (const method of iface.methods) {
      lines.push(`    +${method}()`);
    }
    lines.push("  }");
    nodeCount++;
  }

  // Add classes
  for (const cls of classes) {
    lines.push(`  class ${cls.name} {`);
    for (const prop of cls.properties) {
      lines.push(`    -${prop}`);
    }
    for (const method of cls.methods) {
      lines.push(`    +${method}()`);
    }
    lines.push("  }");
    nodeCount++;

    // Inheritance
    if (cls.extends) {
      lines.push(`  ${cls.extends} <|-- ${cls.name}`);
      edgeCount++;
    }

    // Implementation
    for (const impl of cls.implements) {
      lines.push(`  ${impl} <|.. ${cls.name}`);
      edgeCount++;
    }
  }

  return {
    diagram: lines.join("\n"),
    format: "mermaid",
    type: "class",
    nodeCount,
    edgeCount,
  };
}

/**
 * Generate architecture diagram from directory structure
 */
async function generateArchitectureDiagram(
  rootPath: string,
): Promise<DiagramOutput> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const dirs = entries.filter(
    (e) =>
      e.isDirectory() &&
      !e.name.startsWith(".") &&
      !["node_modules", "dist", "build", "coverage", "__pycache__", "target"].includes(e.name),
  );

  const lines: string[] = ["graph TD"];
  let nodeCount = 0;
  let edgeCount = 0;

  // Root node
  const rootName = path.basename(rootPath);
  lines.push(`  ROOT["${rootName}"]`);
  nodeCount++;

  for (const dir of dirs) {
    const dirId = dir.name.replace(/[^a-zA-Z0-9]/g, "_");
    lines.push(`  ${dirId}["${dir.name}/"]`);
    lines.push(`  ROOT --> ${dirId}`);
    nodeCount++;
    edgeCount++;

    // Sub-directories (one level deep)
    try {
      const subEntries = await fs.readdir(path.join(rootPath, dir.name), {
        withFileTypes: true,
      });
      const subDirs = subEntries.filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !["node_modules", "dist"].includes(e.name),
      );

      for (const subDir of subDirs.slice(0, 8)) {
        const subDirId = `${dirId}_${subDir.name.replace(/[^a-zA-Z0-9]/g, "_")}`;
        lines.push(`  ${subDirId}["${subDir.name}/"]`);
        lines.push(`  ${dirId} --> ${subDirId}`);
        nodeCount++;
        edgeCount++;
      }
    } catch {
      // Skip dirs that can't be read
    }
  }

  return {
    diagram: lines.join("\n"),
    format: "mermaid",
    type: "architecture",
    nodeCount,
    edgeCount,
  };
}

/**
 * Generate flowchart from description
 */
function generateFlowchartFromDescription(
  description: string,
): DiagramOutput {
  // Parse steps from description
  const steps = description
    .split(/[.\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  if (steps.length === 0) {
    return {
      diagram: "graph TD\n  A[Start] --> B[End]",
      format: "mermaid",
      type: "flowchart",
      nodeCount: 2,
      edgeCount: 1,
    };
  }

  const lines: string[] = ["graph TD"];
  let nodeCount = 0;
  let edgeCount = 0;

  // Create nodes from steps
  const nodeIds: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] ?? "";
    const id = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");
    nodeIds.push(id);

    // Detect conditionals
    if (step.toLowerCase().includes("if ") || step.toLowerCase().includes("check")) {
      lines.push(`  ${id}{{"${step}"}}`);
    } else {
      lines.push(`  ${id}["${step}"]`);
    }
    nodeCount++;
  }

  // Connect nodes sequentially
  for (let i = 0; i < nodeIds.length - 1; i++) {
    lines.push(`  ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
    edgeCount++;
  }

  return {
    diagram: lines.join("\n"),
    format: "mermaid",
    type: "flowchart",
    nodeCount,
    edgeCount,
  };
}

/**
 * Generate sequence diagram from description
 */
function generateSequenceDiagramFromDescription(
  description: string,
): DiagramOutput {
  const steps = description
    .split(/[.\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  const lines: string[] = ["sequenceDiagram"];
  let nodeCount = 0;
  let edgeCount = 0;

  // Extract actors from description (capitalized words or quoted words)
  const actors = new Set<string>();
  const actorPattern = /\b([A-Z][a-zA-Z]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = actorPattern.exec(description)) !== null) {
    if (!["The", "This", "That", "When", "Then", "If", "And", "Or", "But", "For"].includes(match[1] ?? "")) {
      actors.add(match[1] ?? "");
    }
  }

  // Ensure at least 2 actors
  const actorList = Array.from(actors).slice(0, 6);
  if (actorList.length < 2) {
    actorList.push("Client", "Server");
  }

  // Add participants
  for (const actor of actorList) {
    lines.push(`  participant ${actor}`);
    nodeCount++;
  }

  // Add interactions
  for (const step of steps) {
    const from = actorList.find((a) => step.includes(a)) ?? actorList[0] ?? "Client";
    const to =
      actorList.find((a) => a !== from && step.includes(a)) ??
      actorList[actorList.indexOf(from) === 0 ? 1 : 0] ?? "Server";

    const shortStep = step.length > 40 ? step.slice(0, 40) + "..." : step;
    lines.push(`  ${from}->>+${to}: ${shortStep}`);
    edgeCount++;
  }

  return {
    diagram: lines.join("\n"),
    format: "mermaid",
    type: "sequence",
    nodeCount,
    edgeCount,
  };
}

/**
 * Diagram generation tool
 */
export const generateDiagramTool: ToolDefinition<
  {
    type: "class" | "sequence" | "flowchart" | "architecture" | "er" | "mindmap";
    description?: string;
    path?: string;
    include?: string;
    format?: "mermaid" | "plantuml";
  },
  DiagramOutput
> = defineTool({
  name: "generate_diagram",
  description: `Generate Mermaid diagrams from code analysis or natural language descriptions.

Examples:
- Class diagram from code: { "type": "class", "path": "src/" }
- Architecture overview: { "type": "architecture", "path": "." }
- Flowchart from description: { "type": "flowchart", "description": "User logs in. System validates credentials. If valid, create session. Redirect to dashboard." }
- Sequence diagram: { "type": "sequence", "description": "Client sends request to Server. Server queries Database. Database returns results. Server responds to Client." }`,
  category: "document",
  parameters: z.object({
    type: z
      .enum(["class", "sequence", "flowchart", "architecture", "er", "mindmap"])
      .describe("Type of diagram to generate"),
    description: z
      .string()
      .optional()
      .describe("Natural language description (for flowchart, sequence, er, mindmap)"),
    path: z
      .string()
      .optional()
      .describe("Source path to analyze (for class, architecture)"),
    include: z
      .string()
      .optional()
      .describe("File glob pattern for code analysis"),
    format: z
      .enum(["mermaid", "plantuml"])
      .optional()
      .default("mermaid")
      .describe("Output format"),
  }),
  async execute({ type, description, path: rootPath, include, format }) {
    if (format === "plantuml") {
      throw new ToolError(
        "PlantUML format is not yet supported. Use 'mermaid' format.",
        { tool: "generate_diagram" },
      );
    }

    const absPath = rootPath ? path.resolve(rootPath) : process.cwd();

    switch (type) {
      case "class":
        return generateClassDiagram(absPath, include);

      case "architecture":
        return generateArchitectureDiagram(absPath);

      case "flowchart":
        if (!description) {
          throw new ToolError(
            "A 'description' is required for flowchart diagrams",
            { tool: "generate_diagram" },
          );
        }
        return generateFlowchartFromDescription(description);

      case "sequence":
        if (!description) {
          throw new ToolError(
            "A 'description' is required for sequence diagrams",
            { tool: "generate_diagram" },
          );
        }
        return generateSequenceDiagramFromDescription(description);

      case "er":
        if (!description) {
          throw new ToolError(
            "A 'description' is required for ER diagrams",
            { tool: "generate_diagram" },
          );
        }
        // Simple ER from description
        return {
          diagram: `erDiagram\n  %% Generated from description\n  %% ${description}`,
          format: "mermaid",
          type: "er",
          nodeCount: 0,
          edgeCount: 0,
        };

      case "mindmap":
        if (!description) {
          throw new ToolError(
            "A 'description' is required for mindmap diagrams",
            { tool: "generate_diagram" },
          );
        }
        // Simple mindmap from description
        const topics = description
          .split(/[,.\n;]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const mmLines = ["mindmap", `  root((${topics[0] ?? "Topic"}))`];
        for (const topic of topics.slice(1)) {
          mmLines.push(`    ${topic}`);
        }
        return {
          diagram: mmLines.join("\n"),
          format: "mermaid",
          type: "mindmap",
          nodeCount: topics.length,
          edgeCount: topics.length - 1,
        };

      default:
        throw new ToolError(`Unsupported diagram type: ${type}`, {
          tool: "generate_diagram",
        });
    }
  },
});

/**
 * All diagram tools
 */
export const diagramTools = [generateDiagramTool];
