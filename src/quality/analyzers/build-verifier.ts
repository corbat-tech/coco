/**
 * Build Verifier
 * Verifies that generated code builds successfully
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

export interface BuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: string;
}

export interface BuildWarning {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: string;
}

export interface BuildResult {
  success: boolean;
  errors: BuildError[];
  warnings: BuildWarning[];
  duration: number;
  stdout: string;
  stderr: string;
}

/**
 * Build Verifier
 */
export class BuildVerifier {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Verify that the project builds successfully
   */
  async verifyBuild(): Promise<BuildResult> {
    const startTime = Date.now();

    try {
      // Detect build command
      const buildCommand = await this.detectBuildCommand();

      if (!buildCommand) {
        return {
          success: true,
          errors: [],
          warnings: [],
          duration: Date.now() - startTime,
          stdout: "No build command detected",
          stderr: "",
        };
      }

      // Run build
      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: this.projectPath,
        timeout: 120000, // 2 minutes
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      // Parse output for errors and warnings
      const errors = this.parseErrors(stdout + stderr);
      const warnings = this.parseWarnings(stdout + stderr);

      return {
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        stdout,
        stderr,
      };
    } catch (error: any) {
      // Build failed
      const errors = this.parseErrors(error.stdout + error.stderr || error.message);
      const warnings = this.parseWarnings(error.stdout + error.stderr || "");

      return {
        success: false,
        errors,
        warnings,
        duration: Date.now() - startTime,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "",
      };
    }
  }

  /**
   * Run TypeScript type checking only (faster than full build)
   */
  async verifyTypes(): Promise<BuildResult> {
    const startTime = Date.now();

    try {
      // Check if TypeScript is available
      const hasTsConfig = await this.fileExists(path.join(this.projectPath, "tsconfig.json"));

      if (!hasTsConfig) {
        return {
          success: true,
          errors: [],
          warnings: [],
          duration: Date.now() - startTime,
          stdout: "No tsconfig.json found",
          stderr: "",
        };
      }

      // Run tsc --noEmit
      const { stdout, stderr } = await execAsync("npx tsc --noEmit", {
        cwd: this.projectPath,
        timeout: 60000, // 1 minute
        maxBuffer: 10 * 1024 * 1024,
      });

      const errors = this.parseTypeScriptErrors(stdout + stderr);
      const warnings = this.parseTypeScriptWarnings(stdout + stderr);

      return {
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime,
        stdout,
        stderr,
      };
    } catch (error: any) {
      const errors = this.parseTypeScriptErrors(error.stdout + error.stderr || error.message);
      const warnings = this.parseTypeScriptWarnings(error.stdout + error.stderr || "");

      return {
        success: false,
        errors,
        warnings,
        duration: Date.now() - startTime,
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "",
      };
    }
  }

  /**
   * Detect build command from package.json
   */
  private async detectBuildCommand(): Promise<string | null> {
    try {
      const packageJsonPath = path.join(this.projectPath, "package.json");
      const content = await fs.readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);

      // Check for build script
      if (packageJson.scripts?.build) {
        return "npm run build";
      }

      // Check for TypeScript
      if (packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript) {
        return "npx tsc --noEmit";
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse errors from build output
   */
  private parseErrors(output: string): BuildError[] {
    const errors: BuildError[] = [];

    // TypeScript error format: file.ts(line,col): error TS1234: message
    const tsErrorRegex = /(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)/g;
    let match: RegExpExecArray | null;

    while ((match = tsErrorRegex.exec(output)) !== null) {
      errors.push({
        file: match[1] || "",
        line: parseInt(match[2] || "0", 10),
        column: parseInt(match[3] || "0", 10),
        code: match[4],
        message: match[5] || "",
      });
    }

    // ESLint error format: file.ts:line:col: message
    const eslintErrorRegex = /(.+?):(\d+):(\d+): (.+)/g;
    while ((match = eslintErrorRegex.exec(output)) !== null) {
      if (!output.includes("error")) continue;
      errors.push({
        file: match[1] || "",
        line: parseInt(match[2] || "0", 10),
        column: parseInt(match[3] || "0", 10),
        message: match[4] || "",
      });
    }

    return errors;
  }

  /**
   * Parse warnings from build output
   */
  private parseWarnings(output: string): BuildWarning[] {
    const warnings: BuildWarning[] = [];

    // TypeScript warning format is same as error but with "warning"
    const tsWarningRegex = /(.+?)\((\d+),(\d+)\): warning (TS\d+): (.+)/g;
    let match: RegExpExecArray | null;

    while ((match = tsWarningRegex.exec(output)) !== null) {
      warnings.push({
        file: match[1] || "",
        line: parseInt(match[2] || "0", 10),
        column: parseInt(match[3] || "0", 10),
        code: match[4],
        message: match[5] || "",
      });
    }

    return warnings;
  }

  /**
   * Parse TypeScript-specific errors
   */
  private parseTypeScriptErrors(output: string): BuildError[] {
    return this.parseErrors(output);
  }

  /**
   * Parse TypeScript-specific warnings
   */
  private parseTypeScriptWarnings(output: string): BuildWarning[] {
    return this.parseWarnings(output);
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a build verifier
 */
export function createBuildVerifier(projectPath: string): BuildVerifier {
  return new BuildVerifier(projectPath);
}
