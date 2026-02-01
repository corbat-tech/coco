/**
 * OUTPUT Phase - CI/CD, Docker, and Documentation
 *
 * This phase is responsible for:
 * 1. Generating CI/CD configurations (GitHub Actions, GitLab CI, etc.)
 * 2. Creating Docker and Docker Compose files
 * 3. Generating project documentation
 * 4. Preparing for production deployment
 */

// Types
export type {
  CICDConfig,
  CICDProvider,
  CICDFeatures,
  Environment,
  EnvironmentType,
  SecretReference,
  CICDFile,
  DockerConfig,
  DockerStage,
  ComposeConfig,
  ComposeService,
  DocumentationSet,
  ReleaseConfig,
  OutputConfig,
  OutputResult,
  ProjectMetadata,
} from "./types.js";

export { DEFAULT_OUTPUT_CONFIG } from "./types.js";

// CI/CD Generator
export {
  CICDGenerator,
  createCICDGenerator,
  createDefaultCICDConfig,
} from "./cicd.js";

// Docker Generator
export { DockerGenerator, createDockerGenerator } from "./docker.js";

// Documentation Generator
export { DocsGenerator, createDocsGenerator } from "./docs.js";

// Executor
export { OutputExecutor, createOutputExecutor } from "./executor.js";
