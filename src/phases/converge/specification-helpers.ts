/**
 * Helper functions for the Specification Generator
 */

import { randomUUID } from "node:crypto";
import type { DiscoverySession, Risk, Requirement, ProjectOverview } from "./types.js";

/**
 * Extract project name from input
 */
export function extractProjectName(input: string): string {
  const namePatterns = [
    /(?:called|named|create|build)\s+["']?([a-zA-Z][a-zA-Z0-9-_]+)["']?/i,
    /^([a-zA-Z][a-zA-Z0-9-_]+)\s*[-:]/,
    /project\s+["']?([a-zA-Z][a-zA-Z0-9-_]+)["']?/i,
  ];

  for (const pattern of namePatterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "my-project";
}

/**
 * Infer target users from session requirements
 */
export function inferTargetUsers(session: DiscoverySession): string[] {
  const users: string[] = [];
  const userPatterns = [
    /(?:for|by)\s+(developers?|users?|administrators?|customers?)/gi,
    /(developers?|users?|administrators?|customers?)\s+(?:can|will|should)/gi,
  ];

  const text = session.requirements.map((r) => r.description).join(" ");

  for (const pattern of userPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const user = match[1]?.toLowerCase();
      if (user && !users.includes(user)) {
        users.push(user);
      }
    }
  }

  if (users.length === 0) {
    users.push("developers");
  }

  return users;
}

/**
 * Infer project type from session
 */
export function inferProjectType(session: DiscoverySession): string {
  const text = session.initialInput.toLowerCase();

  if (text.includes("cli") || text.includes("command line")) return "cli";
  if (text.includes("api") || text.includes("rest") || text.includes("graphql"))
    return "api";
  if (text.includes("web app") || text.includes("frontend")) return "web_app";
  if (text.includes("library") || text.includes("package")) return "library";
  if (text.includes("service") || text.includes("daemon")) return "service";
  if (text.includes("full stack") || text.includes("fullstack"))
    return "full_stack";

  return "unknown";
}

/**
 * Assess project complexity
 */
export function assessComplexity(
  session: DiscoverySession
): "simple" | "moderate" | "complex" | "enterprise" {
  const reqCount = session.requirements.length;
  const hasIntegrations = session.requirements.some(
    (r) => r.category === "integration"
  );
  const hasSecurity = session.requirements.some((r) =>
    r.description.toLowerCase().includes("security")
  );

  if (reqCount > 20 || (hasIntegrations && hasSecurity)) return "enterprise";
  if (reqCount > 10 || hasIntegrations) return "complex";
  if (reqCount > 5) return "moderate";
  return "simple";
}

/**
 * Extract integrations from session
 */
export function extractIntegrations(session: DiscoverySession): string[] {
  return session.requirements
    .filter((r) => r.category === "integration")
    .map((r) => r.title);
}

/**
 * Extract deployment info from session
 */
export function extractDeployment(session: DiscoverySession): string {
  const deployReq = session.requirements.find(
    (r) => r.category === "deployment"
  );
  const deployTech = session.techDecisions.find(
    (t) => t.area === "infrastructure"
  );

  if (deployReq) return deployReq.description;
  if (deployTech) return deployTech.decision;
  return "Deployment strategy to be determined";
}

/**
 * Extract out-of-scope items
 */
export function extractOutOfScope(session: DiscoverySession): string[] {
  return session.requirements
    .filter((r) => r.priority === "wont_have")
    .map((r) => r.title);
}

/**
 * Generate project overview from session
 */
export function generateOverview(session: DiscoverySession): ProjectOverview {
  const name = extractProjectName(session.initialInput);
  const description = session.initialInput.substring(0, 500);

  const goals = session.requirements
    .filter((r) => r.priority === "must_have")
    .slice(0, 5)
    .map((r) => r.title);

  const targetUsers = inferTargetUsers(session);

  const successCriteria = session.requirements
    .filter((r) => r.acceptanceCriteria && r.acceptanceCriteria.length > 0)
    .flatMap((r) => r.acceptanceCriteria || [])
    .slice(0, 10);

  return {
    name,
    description,
    goals,
    targetUsers,
    successCriteria,
  };
}

/**
 * Generate risks from session
 */
export function generateRisksFromSession(session: DiscoverySession): Risk[] {
  const risks: Risk[] = [];

  // Generate risks from unconfirmed assumptions
  for (const assumption of session.assumptions.filter((a) => !a.confirmed)) {
    if (assumption.confidence === "low") {
      risks.push({
        id: randomUUID(),
        description: `Assumption may be incorrect: ${assumption.statement}`,
        probability: "medium",
        impact: assumption.impactIfWrong ? "high" : "medium",
        mitigation: "Validate assumption early in development",
      });
    }
  }

  // Add common risks based on tech decisions
  const hasDatabase = session.techDecisions.some((t) => t.area === "database");
  const hasIntegrations = session.requirements.some(
    (r) => r.category === "integration"
  );

  if (hasDatabase) {
    risks.push({
      id: randomUUID(),
      description: "Data migration complexity",
      probability: "medium",
      impact: "medium",
      mitigation: "Plan data model carefully, use migrations",
    });
  }

  if (hasIntegrations) {
    risks.push({
      id: randomUUID(),
      description: "Third-party API changes or unavailability",
      probability: "medium",
      impact: "high",
      mitigation: "Abstract integrations, implement circuit breakers",
    });
  }

  return risks;
}

/**
 * Format requirement priority
 */
export function formatPriority(priority: Requirement["priority"]): string {
  switch (priority) {
    case "must_have":
      return "🔴 Must";
    case "should_have":
      return "🟠 Should";
    case "could_have":
      return "🟢 Could";
    case "wont_have":
      return "⚪ Won't";
    default:
      return priority;
  }
}
