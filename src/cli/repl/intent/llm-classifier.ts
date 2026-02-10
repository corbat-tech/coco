/**
 * LLM Intent Classifier
 *
 * Uses an LLM provider as a fallback classifier for ambiguous intents.
 * Includes a simple cache to avoid redundant LLM calls.
 */

import type { LLMProvider, Message } from "../../../providers/types.js";
import type { IntentType } from "./types.js";

/**
 * Classification result from the LLM
 */
export interface LLMClassificationResult {
  /** Classified intent type */
  intent: IntentType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether result came from cache */
  cached: boolean;
}

/**
 * Cache entry for storing recent classifications
 */
interface CacheEntry {
  result: LLMClassificationResult;
  timestamp: number;
}

/**
 * Valid intent types for classification
 */
const VALID_INTENTS: IntentType[] = [
  "plan",
  "build",
  "init",
  "task",
  "status",
  "help",
  "exit",
  "chat",
  "output",
  "trust",
  "ship",
  "open",
];

/**
 * System prompt for intent classification
 */
const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a coding agent CLI called Corbat-Coco.
Your task is to classify user input into one of these intent types:

- plan: User wants to create a plan, design architecture, or generate specifications
- build: User wants to build, compile, implement, or develop the project
- init: User wants to initialize a new project or start fresh
- task: User wants to work on a specific task or complete a task
- status: User wants to check project status or see progress
- help: User needs help or wants to see available commands
- exit: User wants to exit or quit the REPL
- output: User wants to generate documentation, CI/CD configs, or deployment artifacts
- trust: User wants to check or configure trust/permission levels
- ship: User wants to release, publish, create a PR, or deploy changes
- open: User wants to open a file with the system application or execute a script/program
- chat: General conversation that doesn't match any specific command

Respond with ONLY a JSON object in this exact format:
{"intent": "<intent_type>", "confidence": <0.0-1.0>}

The confidence should reflect how certain you are about the classification:
- 0.9-1.0: Very clear intent
- 0.7-0.9: Fairly clear intent
- 0.5-0.7: Ambiguous but probable intent
- Below 0.5: Use "chat" as fallback`;

/**
 * Default cache TTL in milliseconds (5 minutes)
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum cache size
 */
const MAX_CACHE_SIZE = 100;

/**
 * LLM Intent Classifier
 */
export class LLMIntentClassifier {
  private provider: LLMProvider | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number;

  /**
   * Create a new LLM Intent Classifier
   *
   * @param cacheTTL - Cache TTL in milliseconds (default: 5 minutes)
   */
  constructor(cacheTTL: number = DEFAULT_CACHE_TTL_MS) {
    this.cacheTTL = cacheTTL;
  }

  /**
   * Set the LLM provider to use for classification
   *
   * @param provider - LLM provider instance
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Check if a provider is configured
   */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  /**
   * Normalize input for cache key
   */
  private normalizeInput(input: string): string {
    return input.trim().toLowerCase();
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.cacheTTL;
  }

  /**
   * Get cached classification if available
   */
  private getFromCache(input: string): LLMClassificationResult | null {
    const key = this.normalizeInput(input);
    const entry = this.cache.get(key);

    if (entry && this.isCacheValid(entry)) {
      return { ...entry.result, cached: true };
    }

    // Remove stale entry if found
    if (entry) {
      this.cache.delete(key);
    }

    return null;
  }

  /**
   * Add classification to cache
   */
  private addToCache(input: string, result: LLMClassificationResult): void {
    const key = this.normalizeInput(input);

    // Evict oldest entries if cache is full
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      result: { ...result, cached: false },
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parse LLM response to extract classification
   */
  private parseResponse(response: string): LLMClassificationResult | null {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[^}]+\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as { intent?: string; confidence?: number };

      // Validate intent type
      const intent = parsed.intent?.toLowerCase() as IntentType;
      if (!VALID_INTENTS.includes(intent)) {
        return null;
      }

      // Validate confidence
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
      const normalizedConfidence = Math.max(0, Math.min(1, confidence));

      return {
        intent,
        confidence: normalizedConfidence,
        cached: false,
      };
    } catch {
      return null;
    }
  }

  /**
   * Classify user input using the LLM
   *
   * @param input - User input to classify
   * @returns Classification result or null if classification fails
   */
  async classify(input: string): Promise<LLMClassificationResult | null> {
    // Check if provider is available
    if (!this.provider) {
      return null;
    }

    // Check cache first
    const cached = this.getFromCache(input);
    if (cached) {
      return cached;
    }

    try {
      const messages: Message[] = [
        {
          role: "user",
          content: `Classify this user input: "${input}"`,
        },
      ];

      const response = await this.provider.chat(messages, {
        system: CLASSIFICATION_SYSTEM_PROMPT,
        maxTokens: 100,
        temperature: 0,
      });

      const result = this.parseResponse(response.content);

      if (result) {
        this.addToCache(input, result);
        return result;
      }

      return null;
    } catch (error) {
      // Log error but don't throw - LLM classification is optional
      console.debug(
        "LLM classification failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: MAX_CACHE_SIZE,
      ttlMs: this.cacheTTL,
    };
  }
}

/**
 * Singleton instance of the LLM classifier
 */
let globalClassifier: LLMIntentClassifier | null = null;

/**
 * Get or create the global LLM classifier instance
 */
export function getLLMClassifier(): LLMIntentClassifier {
  if (!globalClassifier) {
    globalClassifier = new LLMIntentClassifier();
  }
  return globalClassifier;
}

/**
 * Set the LLM provider for the global classifier
 *
 * @param provider - LLM provider instance to use for classification
 */
export function setLLMProvider(provider: LLMProvider): void {
  getLLMClassifier().setProvider(provider);
}

/**
 * Check if the global classifier has a provider configured
 */
export function hasLLMProvider(): boolean {
  return globalClassifier?.hasProvider() ?? false;
}
