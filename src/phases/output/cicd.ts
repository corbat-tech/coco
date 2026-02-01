/**
 * CI/CD Generator for the OUTPUT phase
 *
 * Generates CI/CD configurations for various providers
 */

import type {
  CICDConfig,
  CICDFile,
  CICDProvider,
  ProjectMetadata,
} from "./types.js";

/**
 * CI/CD Generator
 */
export class CICDGenerator {
  private metadata: ProjectMetadata;
  private config: CICDConfig;

  constructor(metadata: ProjectMetadata, config: CICDConfig) {
    this.metadata = metadata;
    this.config = config;
  }

  /**
   * Generate CI/CD files based on configuration
   */
  generate(): CICDFile[] {
    switch (this.config.provider) {
      case "github_actions":
        return this.generateGitHubActions();
      case "gitlab_ci":
        return this.generateGitLabCI();
      default:
        return this.generateGitHubActions();
    }
  }

  /**
   * Generate GitHub Actions workflows
   */
  private generateGitHubActions(): CICDFile[] {
    const files: CICDFile[] = [];

    // Main CI workflow
    files.push({
      path: ".github/workflows/ci.yml",
      content: this.generateGitHubCI(),
      description: "Main CI workflow",
    });

    // Release workflow
    if (this.config.features.release) {
      files.push({
        path: ".github/workflows/release.yml",
        content: this.generateGitHubRelease(),
        description: "Release workflow",
      });
    }

    // Dependabot
    if (this.config.features.dependabot) {
      files.push({
        path: ".github/dependabot.yml",
        content: this.generateDependabot(),
        description: "Dependabot configuration",
      });
    }

    return files;
  }

  /**
   * Generate GitHub Actions CI workflow
   */
  private generateGitHubCI(): string {
    const nodeVersion = "22";
    const packageManager = this.metadata.packageManager || "npm";

    const lines: string[] = [];

    lines.push("name: CI");
    lines.push("");
    lines.push("on:");
    lines.push("  push:");
    lines.push("    branches: [main, master]");
    lines.push("  pull_request:");
    lines.push("    branches: [main, master]");
    lines.push("");
    lines.push("jobs:");
    lines.push("  build:");
    lines.push("    runs-on: ubuntu-latest");
    lines.push("");
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    lines.push("");
    lines.push("      - name: Setup Node.js");
    lines.push("        uses: actions/setup-node@v4");
    lines.push("        with:");
    lines.push(`          node-version: '${nodeVersion}'`);

    if (packageManager === "pnpm") {
      lines.push("          cache: 'pnpm'");
      lines.push("");
      lines.push("      - name: Install pnpm");
      lines.push("        uses: pnpm/action-setup@v3");
      lines.push("        with:");
      lines.push("          version: 9");
    } else if (packageManager === "npm") {
      lines.push("          cache: 'npm'");
    }

    lines.push("");
    lines.push("      - name: Install dependencies");
    lines.push(`        run: ${packageManager} install`);

    if (this.config.features.lint) {
      lines.push("");
      lines.push("      - name: Lint");
      lines.push(`        run: ${packageManager} run lint`);
    }

    if (this.config.features.build) {
      lines.push("");
      lines.push("      - name: Build");
      lines.push(`        run: ${packageManager} run build`);
    }

    if (this.config.features.tests) {
      lines.push("");
      lines.push("      - name: Test");
      lines.push(`        run: ${packageManager} run test`);
    }

    if (this.config.features.coverage) {
      lines.push("");
      lines.push("      - name: Test with coverage");
      lines.push(`        run: ${packageManager} run test:coverage`);
      lines.push("");
      lines.push("      - name: Upload coverage");
      lines.push("        uses: codecov/codecov-action@v4");
      lines.push("        with:");
      lines.push("          fail_ci_if_error: false");
    }

    if (this.config.features.security) {
      lines.push("");
      lines.push("  security:");
      lines.push("    runs-on: ubuntu-latest");
      lines.push("    steps:");
      lines.push("      - uses: actions/checkout@v4");
      lines.push("      - name: Run security audit");
      lines.push(`        run: ${packageManager} audit --audit-level=high`);
    }

    return lines.join("\n");
  }

  /**
   * Generate GitHub Actions release workflow
   */
  private generateGitHubRelease(): string {
    const packageManager = this.metadata.packageManager || "npm";

    const lines: string[] = [];

    lines.push("name: Release");
    lines.push("");
    lines.push("on:");
    lines.push("  push:");
    lines.push("    tags:");
    lines.push("      - 'v*'");
    lines.push("");
    lines.push("jobs:");
    lines.push("  release:");
    lines.push("    runs-on: ubuntu-latest");
    lines.push("");
    lines.push("    steps:");
    lines.push("      - uses: actions/checkout@v4");
    lines.push("");
    lines.push("      - name: Setup Node.js");
    lines.push("        uses: actions/setup-node@v4");
    lines.push("        with:");
    lines.push("          node-version: '22'");
    lines.push("          registry-url: 'https://registry.npmjs.org'");

    if (packageManager === "pnpm") {
      lines.push("");
      lines.push("      - name: Install pnpm");
      lines.push("        uses: pnpm/action-setup@v3");
      lines.push("        with:");
      lines.push("          version: 9");
    }

    lines.push("");
    lines.push("      - name: Install dependencies");
    lines.push(`        run: ${packageManager} install`);
    lines.push("");
    lines.push("      - name: Build");
    lines.push(`        run: ${packageManager} run build`);
    lines.push("");
    lines.push("      - name: Publish to npm");
    lines.push(`        run: ${packageManager} publish --access public`);
    lines.push("        env:");
    lines.push("          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    lines.push("");
    lines.push("      - name: Create GitHub Release");
    lines.push("        uses: softprops/action-gh-release@v2");
    lines.push("        with:");
    lines.push("          generate_release_notes: true");

    return lines.join("\n");
  }

  /**
   * Generate Dependabot configuration
   */
  private generateDependabot(): string {
    const lines: string[] = [];

    lines.push("version: 2");
    lines.push("updates:");
    lines.push("  - package-ecosystem: npm");
    lines.push("    directory: /");
    lines.push("    schedule:");
    lines.push("      interval: weekly");
    lines.push("    groups:");
    lines.push("      development-dependencies:");
    lines.push("        dependency-type: development");
    lines.push("      production-dependencies:");
    lines.push("        dependency-type: production");
    lines.push("");
    lines.push("  - package-ecosystem: github-actions");
    lines.push("    directory: /");
    lines.push("    schedule:");
    lines.push("      interval: weekly");

    return lines.join("\n");
  }

  /**
   * Generate GitLab CI
   */
  private generateGitLabCI(): CICDFile[] {
    const packageManager = this.metadata.packageManager || "npm";

    const content = `image: node:22

stages:
  - install
  - lint
  - test
  - build
  - release

cache:
  paths:
    - node_modules/

install:
  stage: install
  script:
    - ${packageManager} install

lint:
  stage: lint
  script:
    - ${packageManager} run lint

test:
  stage: test
  script:
    - ${packageManager} run test
  coverage: '/All files\\s+\\|\\s+[\\d.]+/'

build:
  stage: build
  script:
    - ${packageManager} run build
  artifacts:
    paths:
      - dist/

release:
  stage: release
  only:
    - tags
  script:
    - ${packageManager} publish
`;

    return [
      {
        path: ".gitlab-ci.yml",
        content,
        description: "GitLab CI/CD configuration",
      },
    ];
  }
}

/**
 * Create default CI/CD configuration
 */
export function createDefaultCICDConfig(
  provider: CICDProvider = "github_actions"
): CICDConfig {
  return {
    provider,
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
    environments: [
      {
        name: "production",
        type: "production",
        branch: "main",
        approvalRequired: true,
        secrets: ["NPM_TOKEN"],
      },
    ],
    secrets: [
      {
        name: "NPM_TOKEN",
        description: "NPM publish token",
        required: true,
      },
    ],
  };
}

/**
 * Create a CI/CD generator
 */
export function createCICDGenerator(
  metadata: ProjectMetadata,
  config: CICDConfig
): CICDGenerator {
  return new CICDGenerator(metadata, config);
}
