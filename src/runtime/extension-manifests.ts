export type ExtensionRisk = "read-only" | "write" | "network" | "destructive" | "secrets-sensitive";

export type AgentSurface = "coco" | "claude" | "codex" | "gemini" | "opencode";

export interface SkillManifest {
  name: string;
  description: string;
  triggers: string[];
  requiredTools: string[];
  risk: ExtensionRisk;
  compatibleAgents: AgentSurface[];
  sourcePath?: string;
}

export interface RecipeStep {
  id: string;
  description: string;
  requiredTools?: string[];
  check?: string;
}

export interface RecipeManifest {
  name: string;
  description: string;
  inputs: string[];
  suggestedModels?: string[];
  steps: RecipeStep[];
  checks: string[];
  risk: ExtensionRisk;
}

export interface McpToolPolicy {
  server: string;
  tool: string;
  risk: ExtensionRisk;
  requiresConfirmation: boolean;
  allowedModes: string[];
}

export function createMcpToolPolicy(
  server: string,
  tool: string,
  risk: ExtensionRisk,
  allowedModes: string[] = ["ask", "plan", "build", "debug", "review", "architect"],
): McpToolPolicy {
  return {
    server,
    tool,
    risk,
    requiresConfirmation: risk === "destructive" || risk === "secrets-sensitive",
    allowedModes,
  };
}
