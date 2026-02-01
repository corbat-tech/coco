/**
 * Types and configuration for the Specification Generator
 */

/**
 * Configuration for specification generation
 */
export interface SpecificationConfig {
  /** Include mermaid diagrams */
  includeDiagrams: boolean;

  /** Maximum spec document length */
  maxLength: number;

  /** Include risk analysis */
  includeRisks: boolean;

  /** Output format */
  format: "markdown" | "json";
}

/**
 * Simplified specification format (for tests and simple use cases)
 */
export interface SimpleSpec {
  name: string;
  description?: string;
  requirements?: {
    functional?: (string | { title?: string; description?: string })[];
    nonFunctional?: (string | { title?: string; description?: string })[];
  };
  assumptions?: string[];
  constraints?: string[];
}

/**
 * Default specification configuration
 */
export const DEFAULT_SPEC_CONFIG: SpecificationConfig = {
  includeDiagrams: true,
  maxLength: 50000,
  includeRisks: true,
  format: "markdown",
};
