/**
 * OUTPUT Phase Executor
 *
 * Orchestrates CI/CD, Docker, and documentation generation
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  PhaseExecutor,
  PhaseContext,
  PhaseResult,
  PhaseCheckpoint,
  PhaseArtifact,
} from "../types.js";
import type { OutputConfig, ProjectMetadata } from "./types.js";
import { DEFAULT_OUTPUT_CONFIG } from "./types.js";
export { DEFAULT_OUTPUT_CONFIG } from "./types.js";
import { CICDGenerator, createDefaultCICDConfig } from "./cicd.js";
import { DockerGenerator } from "./docker.js";
import { DocsGenerator } from "./docs.js";

/**
 * OUTPUT phase executor
 */
export class OutputExecutor implements PhaseExecutor {
  readonly name = "output";
  readonly description = "Generate CI/CD, Docker, and documentation";

  private config: OutputConfig;
  private generatedArtifacts: PhaseArtifact[] = [];

  constructor(config: Partial<OutputConfig> = {}) {
    this.config = this.mergeConfig(DEFAULT_OUTPUT_CONFIG, config);
  }

  /**
   * Deep merge configuration
   */
  private mergeConfig(defaults: OutputConfig, overrides: Partial<OutputConfig>): OutputConfig {
    return {
      cicd: {
        ...defaults.cicd,
        ...overrides.cicd,
        features: {
          ...defaults.cicd.features,
          ...overrides.cicd?.features,
        },
      },
      docker: {
        ...defaults.docker,
        ...overrides.docker,
      },
      docs: {
        ...defaults.docs,
        ...overrides.docs,
      },
      release: {
        ...defaults.release,
        ...overrides.release,
      },
    };
  }

  /**
   * Check if the phase can start
   */
  canStart(context: PhaseContext): boolean {
    return context.projectPath !== undefined && context.projectPath.length > 0;
  }

  /**
   * Execute the OUTPUT phase
   */
  async execute(context: PhaseContext): Promise<PhaseResult> {
    const startTime = new Date();
    const artifacts: PhaseArtifact[] = [];

    try {
      // Load project metadata
      const metadata = await this.loadMetadata(context.projectPath);

      // Generate CI/CD files
      const cicdConfig = createDefaultCICDConfig(this.config.cicd.provider);
      cicdConfig.features = {
        ...cicdConfig.features,
        ...this.config.cicd.features,
      };

      const cicdGenerator = new CICDGenerator(metadata, cicdConfig);
      const cicdFiles = cicdGenerator.generate();

      for (const file of cicdFiles) {
        const filePath = path.join(context.projectPath, file.path);
        await this.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, file.content, "utf-8");
        artifacts.push({
          type: "cicd",
          path: filePath,
          description: file.description,
        });
      }

      // Generate Docker files
      if (this.config.docker.enabled) {
        const dockerGenerator = new DockerGenerator(metadata);

        // Dockerfile
        const dockerfile = dockerGenerator.generateDockerfile();
        const dockerfilePath = path.join(context.projectPath, "Dockerfile");
        await fs.writeFile(dockerfilePath, dockerfile, "utf-8");
        artifacts.push({
          type: "deployment",
          path: dockerfilePath,
          description: "Dockerfile",
        });

        // .dockerignore
        const dockerignore = dockerGenerator.generateDockerignore();
        const dockerignorePath = path.join(context.projectPath, ".dockerignore");
        await fs.writeFile(dockerignorePath, dockerignore, "utf-8");
        artifacts.push({
          type: "deployment",
          path: dockerignorePath,
          description: ".dockerignore",
        });

        // docker-compose.yml
        if (this.config.docker.compose) {
          const compose = dockerGenerator.generateDockerCompose();
          const composePath = path.join(context.projectPath, "docker-compose.yml");
          await fs.writeFile(composePath, compose, "utf-8");
          artifacts.push({
            type: "deployment",
            path: composePath,
            description: "Docker Compose configuration",
          });
        }
      }

      // Generate documentation
      const docsGenerator = new DocsGenerator(metadata);
      const docs = docsGenerator.generate();

      // README.md
      if (this.config.docs.readme) {
        const readmePath = path.join(context.projectPath, "README.md");
        await fs.writeFile(readmePath, docs.readme, "utf-8");
        artifacts.push({
          type: "documentation",
          path: readmePath,
          description: "README",
        });
      }

      // CONTRIBUTING.md
      if (this.config.docs.contributing) {
        const contributingPath = path.join(context.projectPath, "CONTRIBUTING.md");
        await fs.writeFile(contributingPath, docs.contributing, "utf-8");
        artifacts.push({
          type: "documentation",
          path: contributingPath,
          description: "Contributing guide",
        });
      }

      // CHANGELOG.md
      if (this.config.docs.changelog) {
        const changelogPath = path.join(context.projectPath, "CHANGELOG.md");
        await fs.writeFile(changelogPath, docs.changelog, "utf-8");
        artifacts.push({
          type: "documentation",
          path: changelogPath,
          description: "Changelog",
        });
      }

      // docs/api.md
      if (this.config.docs.api) {
        const docsDir = path.join(context.projectPath, "docs");
        await this.ensureDir(docsDir);

        if (docs.api) {
          const apiPath = path.join(docsDir, "api.md");
          await fs.writeFile(apiPath, docs.api, "utf-8");
          artifacts.push({
            type: "documentation",
            path: apiPath,
            description: "API documentation",
          });
        }

        if (docs.deployment) {
          const deployPath = path.join(docsDir, "deployment.md");
          await fs.writeFile(deployPath, docs.deployment, "utf-8");
          artifacts.push({
            type: "documentation",
            path: deployPath,
            description: "Deployment guide",
          });
        }

        if (docs.development) {
          const devPath = path.join(docsDir, "development.md");
          await fs.writeFile(devPath, docs.development, "utf-8");
          artifacts.push({
            type: "documentation",
            path: devPath,
            description: "Development guide",
          });
        }
      }

      const endTime = new Date();

      this.generatedArtifacts = artifacts;

      return {
        phase: "output",
        success: true,
        artifacts,
        metrics: {
          startTime,
          endTime,
          durationMs: endTime.getTime() - startTime.getTime(),
          llmCalls: 0,
          tokensUsed: 0,
        },
      };
    } catch (error) {
      return {
        phase: "output",
        success: false,
        artifacts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if the phase can complete
   */
  canComplete(_context: PhaseContext): boolean {
    return this.generatedArtifacts.length > 0;
  }

  /**
   * Create a checkpoint
   */
  async checkpoint(_context: PhaseContext): Promise<PhaseCheckpoint> {
    return {
      phase: "output",
      timestamp: new Date(),
      state: {
        artifacts: this.generatedArtifacts,
        progress: this.generatedArtifacts.length > 0 ? 100 : 0,
        checkpoint: null,
      },
      resumePoint: this.generatedArtifacts.length > 0 ? "complete" : "start",
    };
  }

  /**
   * Restore from checkpoint
   */
  async restore(checkpoint: PhaseCheckpoint, _context: PhaseContext): Promise<void> {
    if (checkpoint.state?.artifacts) {
      this.generatedArtifacts = checkpoint.state.artifacts as PhaseArtifact[];
    }
  }

  /**
   * Load project metadata from package.json
   */
  private async loadMetadata(projectPath: string): Promise<ProjectMetadata> {
    try {
      const packagePath = path.join(projectPath, "package.json");
      const content = await fs.readFile(packagePath, "utf-8");
      const pkg = JSON.parse(content) as {
        name?: string;
        description?: string;
        version?: string;
        author?: string;
        license?: string;
        repository?: { url?: string } | string;
        scripts?: {
          test?: string;
          build?: string;
          start?: string;
        };
      };

      // Detect package manager
      let packageManager = "npm";
      try {
        await fs.access(path.join(projectPath, "pnpm-lock.yaml"));
        packageManager = "pnpm";
      } catch {
        try {
          await fs.access(path.join(projectPath, "yarn.lock"));
          packageManager = "yarn";
        } catch {
          // Default to npm
        }
      }

      // Get repository URL
      let repository: string | undefined;
      if (typeof pkg.repository === "string") {
        repository = pkg.repository;
      } else if (pkg.repository?.url) {
        repository = pkg.repository.url;
      }

      return {
        name: pkg.name || path.basename(projectPath),
        description: pkg.description || "",
        version: pkg.version || "0.1.0",
        language: "typescript",
        packageManager,
        testCommand: pkg.scripts?.test || "test",
        buildCommand: pkg.scripts?.build || "build",
        startCommand: pkg.scripts?.start || "start",
        author: pkg.author,
        license: pkg.license || "MIT",
        repository,
      };
    } catch {
      // Return defaults
      return {
        name: path.basename(projectPath),
        description: "",
        version: "0.1.0",
        language: "typescript",
        packageManager: "npm",
        testCommand: "test",
        buildCommand: "build",
        startCommand: "start",
        license: "MIT",
      };
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Create an OUTPUT phase executor
 */
export function createOutputExecutor(config?: Partial<OutputConfig>): OutputExecutor {
  return new OutputExecutor(config);
}
