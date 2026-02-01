/**
 * Specification Generator for the CONVERGE phase
 *
 * Generates comprehensive project specifications from discovered requirements
 */

import type { DiscoverySession, Specification } from "./types.js";
import {
  DISCOVERY_SYSTEM_PROMPT,
  ARCHITECTURE_PROMPT,
  fillPrompt,
} from "./prompts.js";
import type { LLMProvider } from "../../providers/types.js";
import { PhaseError } from "../../utils/errors.js";

// Re-export types for backwards compatibility
export type { SpecificationConfig, SimpleSpec } from "./specification-types.js";
export { DEFAULT_SPEC_CONFIG } from "./specification-types.js";

// Import helper functions
import {
  generateOverview,
  generateRisksFromSession,
  extractIntegrations,
  extractDeployment,
  extractOutOfScope,
  inferProjectType,
  assessComplexity,
} from "./specification-helpers.js";

// Import markdown generators
import {
  generateSimpleMarkdown,
  generateFullMarkdown,
} from "./specification-markdown.js";

import type { SpecificationConfig, SimpleSpec } from "./specification-types.js";
import { DEFAULT_SPEC_CONFIG } from "./specification-types.js";

/**
 * Specification Generator
 *
 * Creates comprehensive project specification documents
 */
export class SpecificationGenerator {
  private llm: LLMProvider;
  private config: SpecificationConfig;

  constructor(llm: LLMProvider, config: Partial<SpecificationConfig> = {}) {
    this.llm = llm;
    this.config = { ...DEFAULT_SPEC_CONFIG, ...config };
  }

  /**
   * Generate a specification from a discovery session
   */
  async generate(session: DiscoverySession): Promise<Specification> {
    if (session.status !== "complete" && session.status !== "refining") {
      throw new PhaseError(
        "Discovery session is not ready for specification",
        { phase: "converge" }
      );
    }

    // Organize requirements by category
    const functional = session.requirements.filter(
      (r) => r.category === "functional"
    );
    const nonFunctional = session.requirements.filter(
      (r) =>
        r.category === "non_functional" ||
        r.category === "user_experience" ||
        r.category === "deployment"
    );
    const constraints = session.requirements.filter(
      (r) => r.category === "constraint" || r.category === "technical"
    );

    // Generate architecture if not already specified
    const architecture = await this.generateArchitecture(session);

    // Generate risks
    const risks = this.config.includeRisks
      ? generateRisksFromSession(session)
      : [];

    // Build the specification
    const spec: Specification = {
      version: "1.0.0",
      generatedAt: new Date(),

      overview: generateOverview(session),

      requirements: {
        functional,
        nonFunctional,
        constraints,
      },

      technical: {
        stack: session.techDecisions,
        architecture,
        integrations: extractIntegrations(session),
        deployment: extractDeployment(session),
      },

      assumptions: {
        confirmed: session.assumptions.filter((a) => a.confirmed),
        unconfirmed: session.assumptions.filter((a) => !a.confirmed),
        risks,
      },

      outOfScope: extractOutOfScope(session),

      openQuestions: session.openQuestions.filter((q) => !q.asked),
    };

    return spec;
  }

  /**
   * Generate a markdown document from the specification
   * Supports both full Specification and simplified test format
   */
  toMarkdown(spec: Specification | SimpleSpec): string {
    // Check if this is a simple specification (from tests)
    if ("name" in spec && !("overview" in spec)) {
      return generateSimpleMarkdown(spec as SimpleSpec);
    }
    return generateFullMarkdown(spec as Specification);
  }

  /**
   * Generate a markdown document from the specification (alias for toMarkdown)
   */
  generateMarkdown(spec: Specification): string {
    return generateFullMarkdown(spec);
  }

  /**
   * Generate JSON output
   */
  generateJSON(spec: Specification): string {
    return JSON.stringify(spec, null, 2);
  }

  // Private helper methods

  private async generateArchitecture(
    session: DiscoverySession
  ): Promise<string> {
    const projectType = inferProjectType(session);
    const complexity = assessComplexity(session);

    const prompt = fillPrompt(ARCHITECTURE_PROMPT, {
      projectType,
      complexity,
      requirements: JSON.stringify(session.requirements),
      techStack: JSON.stringify(session.techDecisions),
    });

    try {
      const response = await this.llm.chat([
        { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          pattern?: string;
          rationale?: string;
          components?: Array<{
            name?: string;
            responsibility?: string;
            technology?: string;
          }>;
          dataFlow?: string;
          diagramMermaid?: string;
        };

        let architecture = `### Pattern: ${parsed.pattern || "Layered Architecture"}\n\n`;
        architecture += `${parsed.rationale || ""}\n\n`;

        if (parsed.components && parsed.components.length > 0) {
          architecture += "### Components\n\n";
          for (const comp of parsed.components) {
            architecture += `- **${comp.name}**: ${comp.responsibility} (${comp.technology})\n`;
          }
          architecture += "\n";
        }

        if (parsed.dataFlow) {
          architecture += `### Data Flow\n\n${parsed.dataFlow}\n\n`;
        }

        if (this.config.includeDiagrams && parsed.diagramMermaid) {
          architecture += "### Diagram\n\n";
          architecture += "```mermaid\n";
          architecture += parsed.diagramMermaid;
          architecture += "\n```\n";
        }

        return architecture;
      }

      return "Architecture to be determined during ORCHESTRATE phase.";
    } catch {
      return "Architecture to be determined during ORCHESTRATE phase.";
    }
  }
}

/**
 * Create a specification generator with default configuration
 */
export function createSpecificationGenerator(
  llm: LLMProvider,
  config?: Partial<SpecificationConfig>
): SpecificationGenerator {
  return new SpecificationGenerator(llm, config);
}

/**
 * Validate that a specification has all required fields
 * Supports both full Specification and simplified format
 */
export function validateSpecification(spec: unknown): asserts spec is Specification | SimpleSpec {
  if (!spec || typeof spec !== "object") {
    throw new Error("Specification must be an object");
  }

  const s = spec as Record<string, unknown>;

  // Check for simplified format (has name directly)
  if ("name" in s && !("overview" in s)) {
    if (typeof s.name !== "string") {
      throw new Error("Specification must have a name");
    }
    if (!s.requirements || typeof s.requirements !== "object") {
      throw new Error("Specification must have requirements");
    }
    const reqs = s.requirements as Record<string, unknown>;
    if (!Array.isArray(reqs.functional)) {
      throw new Error("Specification must have functional requirements array");
    }
    if (!Array.isArray(reqs.nonFunctional)) {
      throw new Error("Specification must have nonFunctional requirements array");
    }
    return;
  }

  // Full format validation
  if (!s.overview || typeof s.overview !== "object") {
    throw new Error("Specification must have an overview");
  }

  const overview = s.overview as Record<string, unknown>;
  if (!overview.name || typeof overview.name !== "string") {
    throw new Error("Specification overview must have a name");
  }

  if (!s.requirements || typeof s.requirements !== "object") {
    throw new Error("Specification must have requirements");
  }

  const reqs = s.requirements as Record<string, unknown>;
  if (!Array.isArray(reqs.functional)) {
    throw new Error("Specification must have functional requirements array");
  }

  if (!Array.isArray(reqs.nonFunctional)) {
    throw new Error("Specification must have nonFunctional requirements array");
  }
}
