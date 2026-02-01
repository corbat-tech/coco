/**
 * Tests for Docker generator
 */

import { describe, it, expect } from "vitest";

describe("DockerGenerator", () => {
  describe("generateDockerfile", () => {
    it("should generate Node.js Dockerfile for TypeScript", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "typescript",
        packageManager: "npm",
      } as any);

      const dockerfile = generator.generateDockerfile();

      expect(dockerfile).toContain("FROM node:22-alpine");
      expect(dockerfile).toContain("npm ci");
      expect(dockerfile).toContain("npm run build");
      expect(dockerfile).toContain("EXPOSE");
      expect(dockerfile).toContain("USER node");
    });

    it("should generate Node.js Dockerfile for JavaScript", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "javascript",
        packageManager: "npm",
      } as any);

      const dockerfile = generator.generateDockerfile();

      expect(dockerfile).toContain("FROM node:22-alpine");
    });

    it("should use pnpm for pnpm projects", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "typescript",
        packageManager: "pnpm",
      } as any);

      const dockerfile = generator.generateDockerfile();

      expect(dockerfile).toContain("pnpm");
      expect(dockerfile).toContain("pnpm-lock.yaml");
    });

    it("should generate Python Dockerfile", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "python",
      } as any);

      const dockerfile = generator.generateDockerfile();

      expect(dockerfile).toContain("FROM python:3.12-slim");
      expect(dockerfile).toContain("poetry");
      expect(dockerfile).toContain("uvicorn");
    });

    it("should generate Go Dockerfile", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "go",
      } as any);

      const dockerfile = generator.generateDockerfile();

      expect(dockerfile).toContain("FROM golang:1.22-alpine");
      expect(dockerfile).toContain("go mod download");
      expect(dockerfile).toContain("go build");
    });

    it("should use custom port when specified", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "typescript",
        packageManager: "npm",
      } as any);

      const dockerfile = generator.generateDockerfile({ port: 8080 });

      expect(dockerfile).toContain("EXPOSE 8080");
      expect(dockerfile).toContain("PORT=8080");
    });
  });

  describe("generateDockerCompose", () => {
    it("should generate docker-compose.yml", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "typescript",
      } as any);

      const compose = generator.generateDockerCompose();

      expect(compose).toContain("version: '3.8'");
      expect(compose).toContain("services:");
      expect(compose).toContain("test-app:");
      expect(compose).toContain("build:");
      expect(compose).toContain("ports:");
    });

    it("should sanitize service name", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "@scope/Test App Name",
        language: "typescript",
      } as any);

      const compose = generator.generateDockerCompose();

      // Should be lowercase and only contain valid characters
      expect(compose).toContain("scope-test-app-name:");
    });
  });

  describe("generateDockerignore", () => {
    it("should generate .dockerignore", async () => {
      const { DockerGenerator } = await import("./docker.js");

      const generator = new DockerGenerator({
        name: "test-app",
        language: "typescript",
      } as any);

      const dockerignore = generator.generateDockerignore();

      expect(dockerignore).toContain("node_modules");
      expect(dockerignore).toContain(".git");
      expect(dockerignore).toContain(".env");
      expect(dockerignore).toContain("dist");
      expect(dockerignore).toContain("coverage");
      expect(dockerignore).toContain(".github");
    });
  });
});

describe("createDockerGenerator", () => {
  it("should create a DockerGenerator instance", async () => {
    const { createDockerGenerator } = await import("./docker.js");

    const generator = createDockerGenerator({ name: "test" } as any);

    expect(generator).toBeDefined();
  });
});
