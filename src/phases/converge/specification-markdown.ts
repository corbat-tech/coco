/**
 * Markdown generation for specifications
 */

import type { Specification, Requirement } from "./types.js";
import type { SimpleSpec } from "./specification-types.js";
import { formatPriority } from "./specification-helpers.js";

/**
 * Generate markdown from simplified specification format (for tests)
 */
export function generateSimpleMarkdown(spec: SimpleSpec): string {
  const sections: string[] = [];

  sections.push(`# ${spec.name}`);
  sections.push("");

  if (spec.description) {
    sections.push(spec.description);
    sections.push("");
  }

  sections.push("## Requirements");
  sections.push("");

  sections.push("### Functional");
  sections.push("");
  const functional = spec.requirements?.functional || [];
  if (functional.length > 0) {
    for (const req of functional) {
      sections.push(`- ${typeof req === "string" ? req : req}`);
    }
  } else {
    sections.push("*No functional requirements*");
  }
  sections.push("");

  sections.push("### Non-Functional");
  sections.push("");
  const nonFunctional = spec.requirements?.nonFunctional || [];
  if (nonFunctional.length > 0) {
    for (const req of nonFunctional) {
      sections.push(`- ${typeof req === "string" ? req : req}`);
    }
  }
  sections.push("");

  sections.push("## Assumptions");
  sections.push("");
  if (spec.assumptions?.length) {
    for (const a of spec.assumptions) {
      sections.push(`- ${typeof a === "string" ? a : a}`);
    }
  } else {
    sections.push("*No assumptions*");
  }
  sections.push("");

  sections.push("## Constraints");
  sections.push("");
  if (spec.constraints?.length) {
    for (const c of spec.constraints) {
      sections.push(`- ${typeof c === "string" ? c : c}`);
    }
  } else {
    sections.push("*No constraints*");
  }
  sections.push("");

  return sections.join("\n");
}

/**
 * Add requirements table to sections array
 */
function addRequirementsTable(sections: string[], requirements: Requirement[]): void {
  if (requirements.length === 0) {
    sections.push("*No requirements in this category*");
    return;
  }

  sections.push("| ID | Title | Priority | Description |");
  sections.push("|----|-------|----------|-------------|");

  for (const req of requirements) {
    const priority = formatPriority(req.priority);
    // Properly escape both | and \ for markdown tables
    const desc = req.description.substring(0, 100).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    sections.push(`| ${req.id.substring(0, 8)} | ${req.title} | ${priority} | ${desc} |`);
  }

  // Add detailed sections for each requirement
  sections.push("");
  sections.push("### Details");
  sections.push("");

  for (const req of requirements) {
    sections.push(`#### ${req.title}`);
    sections.push("");
    sections.push(req.description);
    sections.push("");

    if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) {
      sections.push("**Acceptance Criteria:**");
      for (const ac of req.acceptanceCriteria) {
        sections.push(`- [ ] ${ac}`);
      }
      sections.push("");
    }
  }
}

/**
 * Generate a full markdown document from the specification
 */
export function generateFullMarkdown(spec: Specification): string {
  const sections: string[] = [];

  // Header
  sections.push(`# ${spec.overview.name} - Project Specification`);
  sections.push("");
  sections.push(`> Generated: ${spec.generatedAt.toISOString()} | Version: ${spec.version}`);
  sections.push("");

  // Table of contents
  sections.push("## Table of Contents");
  sections.push("");
  sections.push("1. [Executive Summary](#executive-summary)");
  sections.push("2. [Goals & Success Criteria](#goals--success-criteria)");
  sections.push("3. [Functional Requirements](#functional-requirements)");
  sections.push("4. [Non-Functional Requirements](#non-functional-requirements)");
  sections.push("5. [Technical Constraints](#technical-constraints)");
  sections.push("6. [Technology Stack](#technology-stack)");
  sections.push("7. [Architecture](#architecture)");
  sections.push("8. [Assumptions & Risks](#assumptions--risks)");
  sections.push("9. [Out of Scope](#out-of-scope)");
  if (spec.openQuestions.length > 0) {
    sections.push("10. [Open Questions](#open-questions)");
  }
  sections.push("");

  // Executive Summary
  sections.push("## Executive Summary");
  sections.push("");
  sections.push(spec.overview.description);
  sections.push("");
  sections.push("**Target Users:**");
  for (const user of spec.overview.targetUsers) {
    sections.push(`- ${user}`);
  }
  sections.push("");

  // Goals & Success Criteria
  sections.push("## Goals & Success Criteria");
  sections.push("");
  sections.push("### Goals");
  sections.push("");
  for (const goal of spec.overview.goals) {
    sections.push(`- ${goal}`);
  }
  sections.push("");
  sections.push("### Success Criteria");
  sections.push("");
  for (const criteria of spec.overview.successCriteria) {
    sections.push(`- [ ] ${criteria}`);
  }
  sections.push("");

  // Functional Requirements
  sections.push("## Functional Requirements");
  sections.push("");
  addRequirementsTable(sections, spec.requirements.functional);
  sections.push("");

  // Non-Functional Requirements
  sections.push("## Non-Functional Requirements");
  sections.push("");
  addRequirementsTable(sections, spec.requirements.nonFunctional);
  sections.push("");

  // Technical Constraints
  sections.push("## Technical Constraints");
  sections.push("");
  addRequirementsTable(sections, spec.requirements.constraints);
  sections.push("");

  // Technology Stack
  sections.push("## Technology Stack");
  sections.push("");
  sections.push("| Area | Decision | Alternatives | Rationale |");
  sections.push("|------|----------|--------------|-----------|");
  for (const tech of spec.technical.stack) {
    sections.push(
      `| ${tech.area} | **${tech.decision}** | ${tech.alternatives.join(", ") || "-"} | ${tech.rationale} |`,
    );
  }
  sections.push("");

  // Architecture
  sections.push("## Architecture");
  sections.push("");
  sections.push(spec.technical.architecture);
  sections.push("");

  // Integrations
  if (spec.technical.integrations.length > 0) {
    sections.push("### Integrations");
    sections.push("");
    for (const integration of spec.technical.integrations) {
      sections.push(`- ${integration}`);
    }
    sections.push("");
  }

  // Deployment
  if (spec.technical.deployment) {
    sections.push("### Deployment");
    sections.push("");
    sections.push(spec.technical.deployment);
    sections.push("");
  }

  // Assumptions & Risks
  sections.push("## Assumptions & Risks");
  sections.push("");

  sections.push("### Confirmed Assumptions");
  sections.push("");
  if (spec.assumptions.confirmed.length > 0) {
    for (const assumption of spec.assumptions.confirmed) {
      sections.push(`- ✅ ${assumption.statement}`);
    }
  } else {
    sections.push("*No confirmed assumptions*");
  }
  sections.push("");

  sections.push("### Unconfirmed Assumptions");
  sections.push("");
  if (spec.assumptions.unconfirmed.length > 0) {
    for (const assumption of spec.assumptions.unconfirmed) {
      sections.push(`- ⚠️ ${assumption.statement} (${assumption.confidence} confidence)`);
      if (assumption.impactIfWrong) {
        sections.push(`  - *Impact if wrong:* ${assumption.impactIfWrong}`);
      }
    }
  } else {
    sections.push("*No unconfirmed assumptions*");
  }
  sections.push("");

  if (spec.assumptions.risks.length > 0) {
    sections.push("### Risks");
    sections.push("");
    sections.push("| Risk | Probability | Impact | Mitigation |");
    sections.push("|------|------------|--------|------------|");
    for (const risk of spec.assumptions.risks) {
      sections.push(
        `| ${risk.description} | ${risk.probability} | ${risk.impact} | ${risk.mitigation} |`,
      );
    }
    sections.push("");
  }

  // Out of Scope
  sections.push("## Out of Scope");
  sections.push("");
  if (spec.outOfScope.length > 0) {
    for (const item of spec.outOfScope) {
      sections.push(`- ${item}`);
    }
  } else {
    sections.push("*Nothing explicitly marked as out of scope*");
  }
  sections.push("");

  // Open Questions
  if (spec.openQuestions.length > 0) {
    sections.push("## Open Questions");
    sections.push("");
    for (const question of spec.openQuestions) {
      sections.push(`### ${question.question}`);
      sections.push("");
      sections.push(`*Context:* ${question.context}`);
      sections.push(`*Importance:* ${question.importance}`);
      if (question.defaultAnswer) {
        sections.push(`*Default answer:* ${question.defaultAnswer}`);
      }
      sections.push("");
    }
  }

  // Footer
  sections.push("---");
  sections.push("");
  sections.push("*This specification was generated by Corbat-Coco*");

  return sections.join("\n");
}
