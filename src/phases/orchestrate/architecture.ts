/**
 * Architecture Generator for the ORCHESTRATE phase
 *
 * Generates architecture documents, components, and diagrams
 */

import { randomUUID } from "node:crypto";
import type {
  ArchitectureDoc,
  ArchitectureDiagram,
  OrchestrateConfig,
} from "./types.js";
import type { Specification } from "../converge/types.js";
import type { LLMProvider } from "../../providers/types.js";
import {
  ARCHITECT_SYSTEM_PROMPT,
  GENERATE_ARCHITECTURE_PROMPT,
  GENERATE_C4_DIAGRAMS_PROMPT,
  GENERATE_SEQUENCE_DIAGRAMS_PROMPT,
  fillPrompt,
} from "./prompts.js";
import { PhaseError } from "../../utils/errors.js";

// Import parsers
import {
  parseOverview,
  parseComponents,
  parseRelationships,
  parseDataModels,
  parseIntegrations,
} from "./architecture-parsers.js";

// Re-export markdown generator for backwards compatibility
export { generateArchitectureMarkdown } from "./architecture-markdown.js";

/**
 * Architecture Generator
 */
export class ArchitectureGenerator {
  private llm: LLMProvider;
  private config: OrchestrateConfig;

  constructor(llm: LLMProvider, config: OrchestrateConfig) {
    this.llm = llm;
    this.config = config;
  }

  /**
   * Generate architecture from specification
   */
  async generate(specification: Specification): Promise<ArchitectureDoc> {
    const baseArchitecture = await this.generateBaseArchitecture(specification);

    const diagrams: ArchitectureDiagram[] = [];

    if (this.config.generateC4Diagrams) {
      const c4Diagrams = await this.generateC4Diagrams(baseArchitecture);
      diagrams.push(...c4Diagrams);
    }

    if (this.config.generateSequenceDiagrams) {
      const seqDiagrams = await this.generateSequenceDiagrams(
        baseArchitecture,
        specification
      );
      diagrams.push(...seqDiagrams);
    }

    return {
      ...baseArchitecture,
      diagrams,
    };
  }

  /**
   * Generate base architecture
   */
  private async generateBaseArchitecture(
    specification: Specification
  ): Promise<ArchitectureDoc> {
    const prompt = fillPrompt(GENERATE_ARCHITECTURE_PROMPT, {
      specification: JSON.stringify(specification.overview),
      techStack: JSON.stringify(specification.technical.stack),
      functionalCount: specification.requirements.functional.length,
      nonFunctionalCount: specification.requirements.nonFunctional.length,
      constraintCount: specification.requirements.constraints.length,
    });

    const response = await this.llm.chat([
      { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        version: "1.0.0",
        generatedAt: new Date(),
        overview: parseOverview(parsed.overview),
        components: parseComponents(parsed.components || []),
        relationships: parseRelationships(parsed.relationships || []),
        dataModels: parseDataModels(parsed.dataModels || []),
        integrations: parseIntegrations(parsed.integrations || []),
        diagrams: [],
      };
    } catch {
      throw new PhaseError("Failed to generate architecture", { phase: "orchestrate" });
    }
  }

  /**
   * Generate C4 diagrams
   */
  private async generateC4Diagrams(
    architecture: ArchitectureDoc
  ): Promise<ArchitectureDiagram[]> {
    const prompt = fillPrompt(GENERATE_C4_DIAGRAMS_PROMPT, {
      architecture: JSON.stringify({
        overview: architecture.overview,
        components: architecture.components,
        relationships: architecture.relationships,
      }),
    });

    try {
      const response = await this.llm.chat([
        { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.generateFallbackC4Diagrams(architecture);
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        diagrams?: Array<{
          id?: string;
          type?: string;
          title?: string;
          description?: string;
          mermaid?: string;
        }>;
      };

      return (parsed.diagrams || []).map((d) => ({
        id: d.id || randomUUID(),
        type: (d.type as ArchitectureDiagram["type"]) || "c4_context",
        title: d.title || "Diagram",
        description: d.description || "",
        mermaid: d.mermaid || "",
      }));
    } catch {
      return this.generateFallbackC4Diagrams(architecture);
    }
  }

  /**
   * Generate sequence diagrams
   */
  private async generateSequenceDiagrams(
    architecture: ArchitectureDoc,
    specification: Specification
  ): Promise<ArchitectureDiagram[]> {
    const prompt = fillPrompt(GENERATE_SEQUENCE_DIAGRAMS_PROMPT, {
      architecture: JSON.stringify({
        overview: architecture.overview,
        components: architecture.components,
      }),
      functionalRequirements: JSON.stringify(
        specification.requirements.functional.slice(0, 5)
      ),
    });

    try {
      const response = await this.llm.chat([
        { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        diagrams?: Array<{
          id?: string;
          type?: string;
          title?: string;
          description?: string;
          mermaid?: string;
        }>;
      };

      return (parsed.diagrams || []).map((d) => ({
        id: d.id || randomUUID(),
        type: "sequence" as const,
        title: d.title || "Sequence Diagram",
        description: d.description || "",
        mermaid: d.mermaid || "",
      }));
    } catch {
      return [];
    }
  }

  /**
   * Generate fallback C4 diagrams if LLM fails
   */
  private generateFallbackC4Diagrams(
    architecture: ArchitectureDoc
  ): ArchitectureDiagram[] {
    const diagrams: ArchitectureDiagram[] = [];

    // Simple context diagram
    let contextMermaid = "C4Context\n";
    contextMermaid += `  title System Context Diagram\n`;
    contextMermaid += `  Person(user, "User", "Primary system user")\n`;
    contextMermaid += `  System(system, "${architecture.overview.description.substring(0, 30)}...", "The system")\n`;

    for (const integration of architecture.integrations) {
      contextMermaid += `  System_Ext(${integration.name.replace(/\s/g, "_")}, "${integration.name}", "${integration.type}")\n`;
    }

    contextMermaid += `  Rel(user, system, "Uses")\n`;

    diagrams.push({
      id: "c4_context",
      type: "c4_context",
      title: "System Context Diagram",
      description: "High-level view of the system and its environment",
      mermaid: contextMermaid,
    });

    // Simple container diagram
    let containerMermaid = "C4Container\n";
    containerMermaid += `  title Container Diagram\n`;

    const layers = new Set(architecture.components.map((c) => c.layer).filter(Boolean));
    for (const layer of layers) {
      containerMermaid += `  Container_Boundary(${layer?.replace(/\s/g, "_")}, "${layer}") {\n`;
      for (const component of architecture.components.filter((c) => c.layer === layer)) {
        containerMermaid += `    Container(${component.id}, "${component.name}", "${component.technology || ""}")\n`;
      }
      containerMermaid += `  }\n`;
    }

    diagrams.push({
      id: "c4_container",
      type: "c4_container",
      title: "Container Diagram",
      description: "Shows the major containers/deployable units",
      mermaid: containerMermaid,
    });

    return diagrams;
  }
}

/**
 * Create an architecture generator
 */
export function createArchitectureGenerator(
  llm: LLMProvider,
  config: OrchestrateConfig
): ArchitectureGenerator {
  return new ArchitectureGenerator(llm, config);
}
