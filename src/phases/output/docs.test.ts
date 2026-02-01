/**
 * Tests for Documentation Generator
 */

import { describe, it, expect } from "vitest";
import {
  DocsGenerator,
  createDocsGenerator,
} from "./docs.js";
import type { ProjectMetadata } from "./types.js";

// Helper to create mock metadata
function createMockMetadata(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  return {
    name: "test-project",
    description: "A test project for documentation generation",
    version: "1.0.0",
    language: "typescript",
    packageManager: "pnpm",
    testCommand: "pnpm test",
    buildCommand: "pnpm build",
    startCommand: "pnpm start",
    author: "Test Author",
    license: "MIT",
    repository: "https://github.com/test/test-project",
    ...overrides,
  };
}

describe("DocsGenerator", () => {
  describe("constructor", () => {
    it("should create generator with metadata", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      expect(generator).toBeDefined();
    });
  });

  describe("generate", () => {
    it("should generate complete documentation set", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const docs = generator.generate();

      expect(docs).toBeDefined();
      expect(docs.readme).toBeDefined();
      expect(docs.contributing).toBeDefined();
      expect(docs.changelog).toBeDefined();
      expect(docs.api).toBeDefined();
      expect(docs.deployment).toBeDefined();
      expect(docs.development).toBeDefined();
    });

    it("should generate non-empty documentation", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const docs = generator.generate();

      expect(docs.readme.length).toBeGreaterThan(0);
      expect(docs.contributing.length).toBeGreaterThan(0);
      expect(docs.changelog.length).toBeGreaterThan(0);
      expect(docs.api.length).toBeGreaterThan(0);
      expect(docs.deployment.length).toBeGreaterThan(0);
      expect(docs.development.length).toBeGreaterThan(0);
    });
  });

  describe("generateReadme", () => {
    it("should include project name as title", () => {
      const metadata = createMockMetadata({ name: "my-awesome-project" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("# my-awesome-project");
    });

    it("should include project description", () => {
      const metadata = createMockMetadata({ description: "An incredible project" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("An incredible project");
    });

    it("should use pnpm commands when packageManager is pnpm", () => {
      const metadata = createMockMetadata({ packageManager: "pnpm" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("pnpm install");
      expect(readme).toContain("pnpm dev");
      expect(readme).toContain("pnpm build");
      expect(readme).toContain("pnpm test");
    });

    it("should use npm commands when packageManager is npm", () => {
      const metadata = createMockMetadata({ packageManager: "npm" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("npm install");
      expect(readme).toContain("npm run dev");
      expect(readme).toContain("npm run build");
      expect(readme).toContain("npm run test");
    });

    it("should use npm commands when packageManager is not specified", () => {
      const metadata = createMockMetadata({ packageManager: undefined as unknown as string });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("npm run");
    });

    it("should include badges", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("License: MIT");
      expect(readme).toContain("Node.js Version");
    });

    it("should include installation section", () => {
      const metadata = createMockMetadata({ name: "my-lib" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("## Installation");
      expect(readme).toContain("my-lib");
    });

    it("should include usage section", () => {
      const metadata = createMockMetadata({ name: "my-lib" });
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("## Usage");
      expect(readme).toContain("import { ... } from 'my-lib'");
    });

    it("should include documentation links", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("API Reference");
      expect(readme).toContain("Contributing Guide");
      expect(readme).toContain("Changelog");
    });

    it("should include development section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("## Development");
      expect(readme).toContain("test:coverage");
      expect(readme).toContain("lint");
      expect(readme).toContain("format");
    });

    it("should include Corbat-Coco attribution", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const readme = generator.generateReadme();

      expect(readme).toContain("Generated by [Corbat-Coco]");
    });
  });

  describe("generateContributing", () => {
    it("should include project name in title", () => {
      const metadata = createMockMetadata({ name: "cool-project" });
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("# Contributing to cool-project");
    });

    it("should include development setup instructions", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("## Development Setup");
      expect(contributing).toContain("Fork and clone");
    });

    it("should use correct package manager commands", () => {
      const metadata = createMockMetadata({ packageManager: "pnpm" });
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("pnpm install");
      expect(contributing).toContain("pnpm test");
    });

    it("should include conventional commits guide", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("Conventional Commits");
      expect(contributing).toContain("feat:");
      expect(contributing).toContain("fix:");
      expect(contributing).toContain("docs:");
      expect(contributing).toContain("refactor:");
      expect(contributing).toContain("test:");
    });

    it("should include pull request process", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("## Pull Request Process");
      expect(contributing).toContain("PR Checklist");
    });

    it("should include code style guidelines", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const contributing = generator.generateContributing();

      expect(contributing).toContain("## Code Style");
      expect(contributing).toContain("TypeScript");
    });
  });

  describe("generateChangelog", () => {
    it("should include project name", () => {
      const metadata = createMockMetadata({ name: "my-project" });
      const generator = new DocsGenerator(metadata);

      const changelog = generator.generateChangelog();

      expect(changelog).toContain("my-project");
    });

    it("should include version from metadata", () => {
      const metadata = createMockMetadata({ version: "2.5.0" });
      const generator = new DocsGenerator(metadata);

      const changelog = generator.generateChangelog();

      expect(changelog).toContain("[2.5.0]");
    });

    it("should include current date", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const changelog = generator.generateChangelog();

      // Should contain a date in YYYY-MM-DD format
      expect(changelog).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should follow Keep a Changelog format", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const changelog = generator.generateChangelog();

      expect(changelog).toContain("Keep a Changelog");
      expect(changelog).toContain("Semantic Versioning");
      expect(changelog).toContain("### Added");
      expect(changelog).toContain("### Changed");
      expect(changelog).toContain("### Deprecated");
      expect(changelog).toContain("### Removed");
      expect(changelog).toContain("### Fixed");
      expect(changelog).toContain("### Security");
    });
  });

  describe("generateApiDocs", () => {
    it("should include project name", () => {
      const metadata = createMockMetadata({ name: "api-lib" });
      const generator = new DocsGenerator(metadata);

      const apiDocs = generator.generateApiDocs();

      expect(apiDocs).toContain("# API Reference");
      expect(apiDocs).toContain("## api-lib");
    });

    it("should include table of contents", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const apiDocs = generator.generateApiDocs();

      expect(apiDocs).toContain("## Table of Contents");
      expect(apiDocs).toContain("[Installation]");
      expect(apiDocs).toContain("[Configuration]");
      expect(apiDocs).toContain("[API]");
      expect(apiDocs).toContain("[Examples]");
    });

    it("should include configuration section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const apiDocs = generator.generateApiDocs();

      expect(apiDocs).toContain("## Configuration");
      expect(apiDocs).toContain("Configuration options");
    });

    it("should include API section with function template", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const apiDocs = generator.generateApiDocs();

      expect(apiDocs).toContain("## API");
      expect(apiDocs).toContain("### Functions");
      expect(apiDocs).toContain("**Parameters:**");
      expect(apiDocs).toContain("**Returns:**");
    });

    it("should include examples section", () => {
      const metadata = createMockMetadata({ name: "my-api" });
      const generator = new DocsGenerator(metadata);

      const apiDocs = generator.generateApiDocs();

      expect(apiDocs).toContain("## Examples");
      expect(apiDocs).toContain("### Basic Usage");
      expect(apiDocs).toContain("### Advanced Usage");
      expect(apiDocs).toContain("import { ... } from 'my-api'");
    });
  });

  describe("generateDeploymentDocs", () => {
    it("should include project name", () => {
      const metadata = createMockMetadata({ name: "deploy-app" });
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("# Deployment Guide");
      expect(deployDocs).toContain("## deploy-app");
    });

    it("should include prerequisites", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("## Prerequisites");
      expect(deployDocs).toContain("Node.js 22+");
      expect(deployDocs).toContain("Docker");
    });

    it("should include environment variables section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("## Environment Variables");
      expect(deployDocs).toContain("NODE_ENV");
      expect(deployDocs).toContain("PORT");
    });

    it("should include Docker deployment instructions", () => {
      const metadata = createMockMetadata({ name: "my-app" });
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("### 1. Docker Deployment");
      expect(deployDocs).toContain("docker build -t my-app");
      expect(deployDocs).toContain("docker run -p 3000:3000 my-app");
    });

    it("should include Docker Compose instructions", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("### 2. Docker Compose");
      expect(deployDocs).toContain("docker compose up -d");
    });

    it("should include cloud platform instructions", () => {
      const metadata = createMockMetadata({ name: "cloud-app" });
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("### 3. Cloud Platforms");
      expect(deployDocs).toContain("#### AWS");
      expect(deployDocs).toContain("#### Google Cloud");
      expect(deployDocs).toContain("gcloud run deploy cloud-app");
      expect(deployDocs).toContain("#### Azure");
      expect(deployDocs).toContain("az containerapp up --name cloud-app");
    });

    it("should include health checks section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("## Health Checks");
      expect(deployDocs).toContain("/health");
      expect(deployDocs).toContain("/ready");
    });

    it("should include monitoring section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("## Monitoring");
      expect(deployDocs).toContain("Prometheus");
    });

    it("should include scaling recommendations", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const deployDocs = generator.generateDeploymentDocs();

      expect(deployDocs).toContain("## Scaling");
      expect(deployDocs).toContain("Horizontal scaling");
    });
  });

  describe("generateDevelopmentDocs", () => {
    it("should include prerequisites", () => {
      const metadata = createMockMetadata({ packageManager: "pnpm" });
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Getting Started");
      expect(devDocs).toContain("### Prerequisites");
      expect(devDocs).toContain("Node.js 22+");
      expect(devDocs).toContain("pnpm");
    });

    it("should include setup instructions", () => {
      const metadata = createMockMetadata({ packageManager: "pnpm" });
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("### Setup");
      expect(devDocs).toContain("git clone");
      expect(devDocs).toContain("pnpm install");
      expect(devDocs).toContain("pnpm dev");
    });

    it("should include project structure", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Project Structure");
      expect(devDocs).toContain("src/");
      expect(devDocs).toContain("tests/");
      expect(devDocs).toContain("docs/");
    });

    it("should include development commands table", () => {
      const metadata = createMockMetadata({ packageManager: "npm" });
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Development Commands");
      expect(devDocs).toContain("| Command | Description |");
      expect(devDocs).toContain("npm run dev");
      expect(devDocs).toContain("npm run build");
      expect(devDocs).toContain("npm run test");
    });

    it("should include debugging section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Debugging");
      expect(devDocs).toContain("### VS Code");
      expect(devDocs).toContain("### Node Inspector");
      expect(devDocs).toContain("--inspect");
    });

    it("should include testing section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Testing");
      expect(devDocs).toContain("### Running Tests");
      expect(devDocs).toContain("### Writing Tests");
      expect(devDocs).toContain("vitest");
    });

    it("should include code style section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Code Style");
      expect(devDocs).toContain("TypeScript strict mode");
    });

    it("should include troubleshooting section", () => {
      const metadata = createMockMetadata();
      const generator = new DocsGenerator(metadata);

      const devDocs = generator.generateDevelopmentDocs();

      expect(devDocs).toContain("## Troubleshooting");
      expect(devDocs).toContain("### Common Issues");
      expect(devDocs).toContain("Node version mismatch");
      expect(devDocs).toContain("Dependency issues");
      expect(devDocs).toContain("Build errors");
    });
  });
});

describe("createDocsGenerator", () => {
  it("should create a DocsGenerator instance", () => {
    const metadata = createMockMetadata();
    const generator = createDocsGenerator(metadata);

    expect(generator).toBeInstanceOf(DocsGenerator);
  });

  it("should pass metadata to generator", () => {
    const metadata = createMockMetadata({ name: "factory-test" });
    const generator = createDocsGenerator(metadata);

    const docs = generator.generate();

    expect(docs.readme).toContain("factory-test");
  });
});
