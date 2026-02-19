/**
 * Configuration schema for Corbat-Coco
 */

import { z } from "zod";

/**
 * Provider configuration schema
 */
export const ProviderConfigSchema = z.object({
  type: z
    .enum(["anthropic", "openai", "gemini", "kimi", "lmstudio", "ollama"])
    .default("anthropic"),
  apiKey: z.string().optional(),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().min(1).max(200000).default(8192),
  temperature: z.number().min(0).max(2).default(0),
  timeout: z.number().min(1000).default(120000),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Quality configuration schema
 */
export const QualityConfigSchema = z
  .object({
    minScore: z.number().min(0).max(100).default(85),
    minCoverage: z.number().min(0).max(100).default(80),
    maxIterations: z.number().min(1).max(20).default(10),
    minIterations: z.number().min(1).max(10).default(2),
    convergenceThreshold: z.number().min(0).max(10).default(2),
    securityThreshold: z.number().min(0).max(100).default(100),
  })
  .refine((data) => data.minIterations <= data.maxIterations, {
    message: "minIterations must be <= maxIterations",
    path: ["minIterations"],
  });

export type QualityConfig = z.infer<typeof QualityConfigSchema>;

/**
 * Persistence configuration schema
 */
export const PersistenceConfigSchema = z.object({
  checkpointInterval: z.number().min(60000).default(300000), // 5 min default
  maxCheckpoints: z.number().min(1).max(100).default(50),
  retentionDays: z.number().min(1).max(365).default(7),
  compressOldCheckpoints: z.boolean().default(true),
});

export type PersistenceConfig = z.infer<typeof PersistenceConfigSchema>;

/**
 * Stack configuration schema
 */
export const StackConfigSchema = z.object({
  language: z.enum(["typescript", "python", "go", "rust", "java"]),
  framework: z.string().optional(),
  profile: z.string().optional(), // Custom profile path
});

export type StackConfig = z.infer<typeof StackConfigSchema>;

/**
 * Project configuration schema
 */
export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default("0.1.0"),
  description: z.string().optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * GitHub integration configuration
 */
export const GitHubConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().optional(),
  repo: z.string().optional(),
  createPRs: z.boolean().default(true),
  createIssues: z.boolean().default(true),
});

export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

/**
 * Integrations configuration schema
 */
export const IntegrationsConfigSchema = z.object({
  github: GitHubConfigSchema.optional(),
});

export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;

/**
 * MCP server configuration in coco config
 */
export const MCPServerConfigEntrySchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  auth: z
    .object({
      type: z.enum(["oauth", "bearer", "apikey"]),
      token: z.string().optional(),
      tokenEnv: z.string().optional(),
      headerName: z.string().optional(),
    })
    .optional(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});

export type MCPServerConfigEntry = z.infer<typeof MCPServerConfigEntrySchema>;

/**
 * MCP configuration schema
 */
export const MCPConfigSchema = z.object({
  enabled: z.boolean().default(true),
  configFile: z.string().optional(), // Path to external MCP config file
  servers: z.array(MCPServerConfigEntrySchema).default([]),
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

/**
 * Tools configuration schema
 */
export const ToolsConfigSchema = z.object({
  webSearch: z
    .object({
      engine: z.enum(["duckduckgo", "brave", "serpapi"]).default("duckduckgo"),
      apiKey: z.string().optional(),
      maxResults: z.number().min(1).max(20).default(5),
    })
    .optional(),
  memory: z
    .object({
      maxMemories: z.number().min(1).max(10000).default(1000),
      scope: z.enum(["global", "project", "both"]).default("project"),
    })
    .optional(),
  checkpoint: z
    .object({
      maxCheckpoints: z.number().min(1).max(200).default(50),
      useGitStash: z.boolean().default(true),
    })
    .optional(),
  semanticSearch: z
    .object({
      model: z.string().default("all-MiniLM-L6-v2"),
      chunkSize: z.number().min(5).max(100).default(20),
      threshold: z.number().min(0).max(1).default(0.3),
    })
    .optional(),
});

export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;

/**
 * Ship workflow configuration schema
 */
export const ShipConfigSchema = z.object({
  /** Default base branch for PRs */
  defaultBaseBranch: z.string().default("main"),
  /** Auto-detect version bump from commit history */
  autoDetectBump: z.boolean().default(true),
  /** Use squash merge for PRs */
  squashMerge: z.boolean().default(true),
  /** Delete feature branch after merge */
  deleteBranchAfterMerge: z.boolean().default(true),
  /** Create PRs as draft by default */
  draftPr: z.boolean().default(false),
  /** CI check timeout in ms (default 10 minutes) */
  ciCheckTimeoutMs: z.number().default(600_000),
  /** CI check poll interval in ms (default 15 seconds) */
  ciCheckPollMs: z.number().default(15_000),
});

export type ShipConfig = z.infer<typeof ShipConfigSchema>;

/**
 * Skills configuration schema
 */
export const SkillsConfigSchema = z.object({
  /** Enable/disable skills system */
  enabled: z.boolean().default(true),
  /** Override global skills directory */
  globalDir: z.string().optional(),
  /** Override project skills directory */
  projectDir: z.string().optional(),
  /** Auto-activate skills based on user messages */
  autoActivate: z.boolean().default(true),
  /** Maximum concurrent active markdown skills */
  maxActiveSkills: z.number().min(1).max(10).default(3),
  /** List of skill IDs to disable */
  disabled: z.array(z.string()).default([]),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;

/**
 * Complete configuration schema
 */
export const CocoConfigSchema = z.object({
  project: ProjectConfigSchema,
  provider: ProviderConfigSchema.default({
    type: "anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 8192,
    temperature: 0,
    timeout: 120000,
  }),
  quality: QualityConfigSchema.default({
    minScore: 85,
    minCoverage: 80,
    maxIterations: 10,
    minIterations: 2,
    convergenceThreshold: 2,
    securityThreshold: 100,
  }),
  persistence: PersistenceConfigSchema.default({
    checkpointInterval: 300000,
    maxCheckpoints: 50,
    retentionDays: 7,
    compressOldCheckpoints: true,
  }),
  stack: StackConfigSchema.optional(),
  integrations: IntegrationsConfigSchema.optional(),
  mcp: MCPConfigSchema.optional(),
  tools: ToolsConfigSchema.optional(),
  ship: ShipConfigSchema.optional(),
  skills: SkillsConfigSchema.optional(),
});

export type CocoConfig = z.infer<typeof CocoConfigSchema>;

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): {
  success: boolean;
  data?: CocoConfig;
  error?: z.ZodError;
} {
  const result = CocoConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Create default configuration
 */
export function createDefaultConfigObject(
  projectName: string,
  language: "typescript" | "python" | "go" | "rust" | "java" = "typescript",
): CocoConfig {
  return {
    project: {
      name: projectName,
      version: "0.1.0",
    },
    provider: {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
      maxTokens: 8192,
      temperature: 0,
      timeout: 120000,
    },
    quality: {
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minIterations: 2,
      convergenceThreshold: 2,
      securityThreshold: 100,
    },
    persistence: {
      checkpointInterval: 300000,
      maxCheckpoints: 50,
      retentionDays: 7,
      compressOldCheckpoints: true,
    },
    stack: {
      language,
    },
  };
}
