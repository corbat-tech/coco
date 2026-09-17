import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProjectStack } from "./stack-detector.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "coco stack "));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const write = (name: string, value: string) => fs.writeFile(path.join(root, name), value);

describe("project context from actual manifests", () => {
  it("recognizes a pnpm TypeScript app without executing lifecycle scripts", async () => {
    await write(
      "package.json",
      JSON.stringify({
        dependencies: { react: "19", next: "16" },
        devDependencies: { typescript: "6", vitest: "4", vite: "8", "@playwright/test": "1" },
        scripts: { build: "node -e 'throw Error()'", postinstall: "touch UNEXPECTED" },
      }),
    );
    await write("pnpm-lock.yaml", "lockfileVersion: '9.0'");
    const result = await detectProjectStack(root);
    expect(result).toMatchObject({
      stack: "node",
      packageManager: "pnpm",
      languages: ["JavaScript", "TypeScript"],
    });
    expect(result.frameworks).toEqual(expect.arrayContaining(["React", "Next.js"]));
    expect(result.testingFrameworks).toEqual(expect.arrayContaining(["vitest", "playwright"]));
    expect(result.dependencies.react).toBe("19");
    expect(await fs.readdir(root)).toEqual(
      expect.arrayContaining(["package.json", "pnpm-lock.yaml"]),
    );
    await expect(fs.access(path.join(root, "UNEXPECTED"))).rejects.toThrow();
  });
  it.each([
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ])("respects %s when selecting commands", async (lock, manager) => {
    await write("package.json", "{}");
    await write(lock!, "");
    await write("tsconfig.json", "{}");
    expect(await detectProjectStack(root)).toMatchObject({
      packageManager: manager,
      languages: ["JavaScript", "TypeScript"],
    });
  });
  it("reads updated manifests instead of preserving stale framework context", async () => {
    await write(
      "package.json",
      JSON.stringify({
        dependencies: { vue: "3", nuxt: "4" },
        devDependencies: { webpack: "5", jest: "30" },
      }),
    );
    expect((await detectProjectStack(root)).frameworks).toEqual(
      expect.arrayContaining(["Vue", "Nuxt"]),
    );
    await write(
      "package.json",
      JSON.stringify({
        dependencies: { express: "5", fastify: "5", "@nestjs/core": "11", "@angular/core": "20" },
        devDependencies: {
          rollup: "4",
          tsup: "8",
          esbuild: "0.25",
          mocha: "11",
          chai: "5",
          cypress: "14",
        },
      }),
    );
    const updated = await detectProjectStack(root);
    expect(updated.frameworks).not.toContain("Vue");
    expect(updated.frameworks).toEqual(
      expect.arrayContaining(["Express", "Fastify", "NestJS", "Angular"]),
    );
    expect(updated.buildTools).toEqual(expect.arrayContaining(["rollup", "tsup", "esbuild"]));
    expect(updated.testingFrameworks).toEqual(expect.arrayContaining(["mocha", "chai", "cypress"]));
  });
  it("returns incomplete context rather than crashing on an unfinished package.json", async () => {
    await write("package.json", '{"dependencies":');
    expect(await detectProjectStack(root)).toMatchObject({
      stack: "node",
      dependencies: {},
      frameworks: [],
    });
  });
  it("uses Maven context with unknown versions rather than Node commands", async () => {
    const deps = [
      ["org.springframework.boot", "spring-boot-starter"],
      ["org.springframework.boot", "spring-boot-test"],
      ["org.springframework", "spring-webmvc"],
      ["org.hibernate", "hibernate-core"],
      ["org.junit.jupiter", "junit-jupiter"],
      ["org.mockito", "mockito-core"],
    ];
    await write(
      "pom.xml",
      "<project><dependencies>" +
        deps
          .map(
            ([group, name]) =>
              `<dependency><groupId>${group}</groupId><artifactId>${name}</artifactId></dependency>`,
          )
          .join("") +
        "</dependencies></project>",
    );
    const result = await detectProjectStack(root);
    expect(result).toMatchObject({
      stack: "java",
      packageManager: "maven",
      languages: ["Java"],
      buildTools: ["maven"],
    });
    expect(result.frameworks).toEqual(["Spring Boot", "Spring MVC", "Hibernate"]);
    expect(result.testingFrameworks).toEqual(["JUnit", "Mockito"]);
    expect(result.dependencies["org.mockito:mockito-core"]).toBe("unknown");
  });
  it.each(["build.gradle", "build.gradle.kts"])(
    "recognizes %s without requiring a Maven manifest",
    async (manifest) => {
      await write(manifest, "plugins { java }");
      expect(await detectProjectStack(root)).toMatchObject({
        stack: "java",
        packageManager: "gradle",
        buildTools: ["gradle"],
        languages: ["Java"],
      });
    },
  );
  it("collects Python dependency hints from a Poetry project", async () => {
    await write(
      "pyproject.toml",
      '[tool.poetry.dependencies]\npython = "^3.12"\nfastapi = "^0.115"\ndjango = "^5.0"\nflask = "^3.0"\n[tool.poetry.group.dev.dependencies]\npytest = "^8.0"\n',
    );
    const result = await detectProjectStack(root);
    expect(result).toMatchObject({
      stack: "python",
      packageManager: "pip",
      languages: ["Python"],
      dependencies: { fastapi: "^0.115" },
    });
    expect(result.frameworks).toEqual(expect.arrayContaining(["FastAPI", "Django", "Flask"]));
    expect(result.testingFrameworks).toContain("pytest");
  });
  it.each([
    ["go.mod", "go", "Go"],
    ["Cargo.toml", "rust", "Rust"],
  ])("avoids Node guidance for %s", async (manifest, stack, language) => {
    await write(manifest!, "");
    expect(await detectProjectStack(root)).toMatchObject({ stack, languages: [language] });
  });
  it("reports unknown for an empty project", async () => {
    expect(await detectProjectStack(root)).toMatchObject({
      stack: "unknown",
      packageManager: null,
      dependencies: {},
      frameworks: [],
      languages: [],
    });
  });
});
