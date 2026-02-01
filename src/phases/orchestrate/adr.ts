/**
 * ADR Generator for the ORCHESTRATE phase
 *
 * Generates Architecture Decision Records
 */

import { randomUUID } from "node:crypto";
import type {
  ADR,
  ADRStatus,
  ArchitectureDoc,
  OrchestrateConfig,
} from "./types.js";
import type { Specification } from "../converge/types.js";
import type { LLMProvider } from "../../providers/types.js";
import { ARCHITECT_SYSTEM_PROMPT, GENERATE_ADRS_PROMPT, fillPrompt } from "./prompts.js";
import { PhaseError } from "../../utils/errors.js";

/**
 * ADR Generator
 */
export class ADRGenerator {
  private llm: LLMProvider;
  private config: OrchestrateConfig;

  constructor(llm: LLMProvider, config: OrchestrateConfig) {
    this.llm = llm;
    this.config = config;
  }

  /**
   * Generate ADRs from architecture and specification
   */
  async generate(
    architecture: ArchitectureDoc,
    specification: Specification
  ): Promise<ADR[]> {
    const prompt = fillPrompt(GENERATE_ADRS_PROMPT, {
      architecture: JSON.stringify({
        overview: architecture.overview,
        components: architecture.components.map((c) => ({
          name: c.name,
          type: c.type,
          technology: c.technology,
        })),
      }),
      techStack: JSON.stringify(specification.technical.stack),
      maxADRs: this.config.maxADRs,
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

      const parsed = JSON.parse(jsonMatch[0]) as {
        adrs?: Array<{
          number?: number;
          title?: string;
          status?: string;
          context?: string;
          decision?: string;
          consequences?: {
            positive?: string[];
            negative?: string[];
            neutral?: string[];
          };
          alternatives?: Array<{
            option?: string;
            pros?: string[];
            cons?: string[];
            reason?: string;
          }>;
          references?: string[];
        }>;
      };

      return (parsed.adrs || []).map((adr, index) => this.parseADR(adr, index));
    } catch {
      throw new PhaseError("Failed to generate ADRs", {
        phase: "orchestrate",
      });
    }
  }

  /**
   * Parse a single ADR from LLM response
   */
  private parseADR(
    data: {
      number?: number;
      title?: string;
      status?: string;
      context?: string;
      decision?: string;
      consequences?: {
        positive?: string[];
        negative?: string[];
        neutral?: string[];
      };
      alternatives?: Array<{
        option?: string;
        pros?: string[];
        cons?: string[];
        reason?: string;
      }>;
      references?: string[];
    },
    index: number
  ): ADR {
    return {
      id: randomUUID(),
      number: data.number || index + 1,
      title: data.title || `Decision ${index + 1}`,
      date: new Date(),
      status: (data.status as ADRStatus) || "accepted",
      context: data.context || "",
      decision: data.decision || "",
      consequences: {
        positive: data.consequences?.positive || [],
        negative: data.consequences?.negative || [],
        neutral: data.consequences?.neutral,
      },
      alternatives: (data.alternatives || []).map((alt) => ({
        option: alt.option || "",
        pros: alt.pros || [],
        cons: alt.cons || [],
        reason: alt.reason || "",
      })),
      references: data.references,
    };
  }
}

/**
 * Generate ADR markdown document
 */
export function generateADRMarkdown(adr: ADR): string {
  const sections: string[] = [];

  // Header
  const paddedNumber = String(adr.number).padStart(3, "0");
  sections.push(`# ADR ${paddedNumber}: ${adr.title}`);
  sections.push("");
  sections.push(`**Date:** ${adr.date.toISOString().split("T")[0]}`);
  sections.push(`**Status:** ${adr.status}`);
  sections.push("");

  // Context
  sections.push("## Context");
  sections.push("");
  sections.push(adr.context);
  sections.push("");

  // Decision
  sections.push("## Decision");
  sections.push("");
  sections.push(adr.decision);
  sections.push("");

  // Consequences
  sections.push("## Consequences");
  sections.push("");

  if (adr.consequences.positive.length > 0) {
    sections.push("### Positive");
    sections.push("");
    for (const consequence of adr.consequences.positive) {
      sections.push(`- ✅ ${consequence}`);
    }
    sections.push("");
  }

  if (adr.consequences.negative.length > 0) {
    sections.push("### Negative");
    sections.push("");
    for (const consequence of adr.consequences.negative) {
      sections.push(`- ⚠️ ${consequence}`);
    }
    sections.push("");
  }

  if (adr.consequences.neutral && adr.consequences.neutral.length > 0) {
    sections.push("### Neutral");
    sections.push("");
    for (const consequence of adr.consequences.neutral) {
      sections.push(`- ${consequence}`);
    }
    sections.push("");
  }

  // Alternatives
  if (adr.alternatives && adr.alternatives.length > 0) {
    sections.push("## Alternatives Considered");
    sections.push("");

    for (const alt of adr.alternatives) {
      sections.push(`### ${alt.option}`);
      sections.push("");

      if (alt.pros.length > 0) {
        sections.push("**Pros:**");
        for (const pro of alt.pros) {
          sections.push(`- ${pro}`);
        }
        sections.push("");
      }

      if (alt.cons.length > 0) {
        sections.push("**Cons:**");
        for (const con of alt.cons) {
          sections.push(`- ${con}`);
        }
        sections.push("");
      }

      sections.push(`**Why not chosen:** ${alt.reason}`);
      sections.push("");
    }
  }

  // References
  if (adr.references && adr.references.length > 0) {
    sections.push("## References");
    sections.push("");
    for (const ref of adr.references) {
      sections.push(`- ${ref}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Generate ADR index markdown
 */
export function generateADRIndexMarkdown(adrs: ADR[]): string {
  const sections: string[] = [];

  sections.push("# Architecture Decision Records");
  sections.push("");
  sections.push("This directory contains all Architecture Decision Records (ADRs) for this project.");
  sections.push("");
  sections.push("## Index");
  sections.push("");
  sections.push("| # | Title | Status | Date |");
  sections.push("|---|-------|--------|------|");

  for (const adr of adrs) {
    const paddedNumber = String(adr.number).padStart(3, "0");
    const filename = `${paddedNumber}-${slugify(adr.title)}.md`;
    const dateStr = adr.date.toISOString().split("T")[0];
    sections.push(
      `| ${adr.number} | [${adr.title}](./${filename}) | ${adr.status} | ${dateStr} |`
    );
  }

  sections.push("");
  sections.push("## About ADRs");
  sections.push("");
  sections.push("ADRs are short documents that capture important architectural decisions.");
  sections.push("Each ADR describes:");
  sections.push("- The context and problem being addressed");
  sections.push("- The decision made");
  sections.push("- The consequences (positive and negative)");
  sections.push("- Alternatives considered");
  sections.push("");
  sections.push("For more information, see [ADR GitHub](https://adr.github.io/).");

  return sections.join("\n");
}

/**
 * Get ADR filename from number and title
 */
export function getADRFilename(adr: ADR): string {
  const paddedNumber = String(adr.number).padStart(3, "0");
  return `${paddedNumber}-${slugify(adr.title)}.md`;
}

/**
 * Convert string to URL-friendly slug
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Create an ADR generator
 */
export function createADRGenerator(
  llm: LLMProvider,
  config: OrchestrateConfig
): ADRGenerator {
  return new ADRGenerator(llm, config);
}

/**
 * Standard ADR templates for common decisions
 */
export const ADR_TEMPLATES = {
  architecture: {
    title: "Core Architecture Pattern",
    contextTemplate:
      "We need to choose an architectural pattern that supports our requirements for {{requirements}}.",
    decisionTemplate:
      "We will use {{pattern}} architecture because {{rationale}}.",
  },
  language: {
    title: "Programming Language",
    contextTemplate:
      "We need to choose a programming language for {{component}}.",
    decisionTemplate:
      "We will use {{language}} because {{rationale}}.",
  },
  database: {
    title: "Database Selection",
    contextTemplate:
      "We need to choose a database system for {{dataType}} data.",
    decisionTemplate:
      "We will use {{database}} because {{rationale}}.",
  },
  testing: {
    title: "Testing Strategy",
    contextTemplate:
      "We need to establish a testing strategy to ensure quality.",
    decisionTemplate:
      "We will use {{testFramework}} with {{approach}} because {{rationale}}.",
  },
  deployment: {
    title: "Deployment Strategy",
    contextTemplate:
      "We need to determine how the application will be deployed.",
    decisionTemplate:
      "We will deploy using {{strategy}} because {{rationale}}.",
  },
};
