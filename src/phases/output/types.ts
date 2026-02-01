/**
 * Types for the OUTPUT phase
 *
 * This phase focuses on CI/CD generation, documentation, and deployment
 */

/**
 * CI/CD configuration
 */
export interface CICDConfig {
  provider: CICDProvider;
  features: CICDFeatures;
  environments: Environment[];
  secrets: SecretReference[];
}

/**
 * CI/CD providers
 */
export type CICDProvider =
  | "github_actions"
  | "gitlab_ci"
  | "jenkins"
  | "circleci"
  | "azure_devops";

/**
 * CI/CD features to enable
 */
export interface CICDFeatures {
  /** Run tests on push/PR */
  tests: boolean;

  /** Run linting */
  lint: boolean;

  /** Generate coverage reports */
  coverage: boolean;

  /** Build artifacts */
  build: boolean;

  /** Create releases */
  release: boolean;

  /** Deploy to environments */
  deploy: boolean;

  /** Security scanning */
  security: boolean;

  /** Dependency updates */
  dependabot: boolean;
}

/**
 * Deployment environment
 */
export interface Environment {
  name: string;
  type: EnvironmentType;
  branch?: string;
  approvalRequired: boolean;
  secrets: string[];
}

/**
 * Environment types
 */
export type EnvironmentType =
  | "development"
  | "staging"
  | "production";

/**
 * Secret reference
 */
export interface SecretReference {
  name: string;
  description: string;
  required: boolean;
}

/**
 * Generated CI/CD file
 */
export interface CICDFile {
  path: string;
  content: string;
  description: string;
}

/**
 * Dockerfile configuration
 */
export interface DockerConfig {
  baseImage: string;
  port?: number;
  buildArgs: Record<string, string>;
  envVars: Record<string, string>;
  stages: DockerStage[];
}

/**
 * Docker stage (multi-stage build)
 */
export interface DockerStage {
  name: string;
  baseImage: string;
  commands: string[];
}

/**
 * Docker Compose configuration
 */
export interface ComposeConfig {
  version: string;
  services: ComposeService[];
  networks: string[];
  volumes: string[];
}

/**
 * Docker Compose service
 */
export interface ComposeService {
  name: string;
  image?: string;
  build?: string;
  ports: string[];
  environment: Record<string, string>;
  volumes: string[];
  dependsOn: string[];
}

/**
 * Documentation structure
 */
export interface DocumentationSet {
  readme: string;
  contributing: string;
  changelog: string;
  api?: string;
  deployment?: string;
  development?: string;
}

/**
 * Release configuration
 */
export interface ReleaseConfig {
  versioning: "semver" | "calver" | "custom";
  changelog: boolean;
  assets: string[];
  prerelease: boolean;
}

/**
 * OUTPUT phase configuration
 */
export interface OutputConfig {
  /** CI/CD configuration */
  cicd: {
    provider: CICDProvider;
    features: Partial<CICDFeatures>;
  };

  /** Docker configuration */
  docker: {
    enabled: boolean;
    compose: boolean;
  };

  /** Documentation to generate */
  docs: {
    readme: boolean;
    contributing: boolean;
    changelog: boolean;
    api: boolean;
  };

  /** Release configuration */
  release: Partial<ReleaseConfig>;
}

/**
 * Default OUTPUT configuration
 */
export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  cicd: {
    provider: "github_actions",
    features: {
      tests: true,
      lint: true,
      coverage: true,
      build: true,
      release: true,
      deploy: false,
      security: true,
      dependabot: true,
    },
  },
  docker: {
    enabled: true,
    compose: true,
  },
  docs: {
    readme: true,
    contributing: true,
    changelog: true,
    api: true,
  },
  release: {
    versioning: "semver",
    changelog: true,
    prerelease: false,
  },
};

/**
 * OUTPUT phase result
 */
export interface OutputResult {
  cicdFiles: CICDFile[];
  dockerFiles: string[];
  documentation: DocumentationSet;
  artifactPaths: string[];
}

/**
 * Project metadata for output generation
 */
export interface ProjectMetadata {
  name: string;
  description: string;
  version: string;
  language: string;
  packageManager: string;
  testCommand: string;
  buildCommand: string;
  startCommand: string;
  author?: string;
  license?: string;
  repository?: string;
}
