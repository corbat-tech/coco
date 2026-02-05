/**
 * Intent Recognizer
 *
 * Natural language intent detection engine for the REPL.
 * Uses regex patterns for fast matching with LLM fallback for ambiguous cases.
 */

import type {
  Intent,
  IntentType,
  IntentEntities,
  IntentConfig,
  IntentResolution,
} from "./types.js";
import {
  INTENT_PATTERNS,
  ENTITY_PATTERNS,
  CONFIDENCE,
  calculateConfidenceBoost,
} from "./patterns.js";
import type { LLMProvider } from "../../../providers/types.js";
import {
  getLLMClassifier,
  setLLMProvider as setClassifierProvider,
  hasLLMProvider,
} from "./llm-classifier.js";

/**
 * Threshold below which LLM classification is attempted
 */
const LLM_FALLBACK_THRESHOLD = 0.7;

/**
 * Default configuration
 */
export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  minConfidence: CONFIDENCE["MINIMUM"] ?? 0.5,
  autoExecute: false,
  autoExecuteThreshold: CONFIDENCE["HIGH"] ?? 0.9,
  alwaysConfirm: ["init", "build", "output", "status"],
  autoExecutePreferences: {},
};

/**
 * Create an intent recognizer
 */
export function createIntentRecognizer(config: Partial<IntentConfig> = {}) {
  const fullConfig = { ...DEFAULT_INTENT_CONFIG, ...config };

  /**
   * Extract entities from input
   */
  function extractEntities(input: string): IntentEntities {
    const entities: IntentEntities = {
      flags: [],
      techStack: [],
    };

    // Extract sprint number
    const sprintMatch = ENTITY_PATTERNS.sprint.exec(input);
    if (sprintMatch?.[1]) {
      entities.sprint = parseInt(sprintMatch[1], 10);
    }

    // Extract task ID
    const taskMatch = ENTITY_PATTERNS.taskId.exec(input);
    if (taskMatch?.[1]) {
      entities.taskId = taskMatch[1];
    }

    // Extract project name
    const projectMatch = ENTITY_PATTERNS.projectName.exec(input);
    if (projectMatch?.[1]) {
      entities.projectName = projectMatch[1];
    }

    // Extract flags
    let flagMatch;
    while ((flagMatch = ENTITY_PATTERNS.flags.exec(input)) !== null) {
      if (flagMatch[1]) {
        entities.flags = entities.flags || [];
        entities.flags.push(flagMatch[1]);
      }
    }

    // Extract tech stack - create new regex to avoid global state issues
    const techStackRegex =
      /(node\.?js|typescript|python|go|golang|rust|java|react|vue|angular|docker|kubernetes|aws|gcp|azure|postgres|mysql|mongo|redis)\b/gi;
    const techMatches = input.matchAll(techStackRegex);
    for (const techMatch of techMatches) {
      entities.techStack = entities.techStack || [];
      if (techMatch[1]) {
        const tech = techMatch[1].toLowerCase();
        if (!entities.techStack.includes(tech)) {
          entities.techStack.push(tech);
        }
      }
    }

    // Extract additional args (quoted strings or words after main command)
    const args: string[] = [];
    const quotedMatches = input.match(/"([^"]+)"|'([^']+)'/g);
    if (quotedMatches) {
      for (const match of quotedMatches) {
        args.push(match.replace(/["']/g, ""));
      }
    }
    entities.args = args;

    return entities;
  }

  /**
   * Match input against patterns for a specific intent type
   */
  function matchIntent(
    input: string,
    type: IntentType,
  ): { matched: boolean; confidence: number; pattern?: string } {
    const patterns = INTENT_PATTERNS[type];

    for (const pattern of patterns) {
      if (pattern.test(input)) {
        // Calculate base confidence based on match quality
        let confidence = CONFIDENCE["MEDIUM"] ?? 0.75;

        // Exact match gets higher confidence
        if (input.toLowerCase().trim() === type.toLowerCase()) {
          confidence = CONFIDENCE["HIGH"] ?? 0.9;
        }

        // Add boost based on input characteristics
        confidence += calculateConfidenceBoost(input);

        return {
          matched: true,
          confidence: Math.min(1, confidence),
          pattern: pattern.source,
        };
      }
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * Recognize intent from input
   */
  async function recognize(input: string): Promise<Intent> {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      return {
        type: "chat",
        confidence: 1,
        entities: {},
        raw: input,
      };
    }

    // Try to match against all intent types except chat (fallback)
    const intentTypes: IntentType[] = [
      "plan",
      "build",
      "task",
      "init",
      "output",
      "status",
      "trust",
      "help",
      "exit",
    ];

    let bestMatch: Intent | null = null;

    for (const type of intentTypes) {
      const match = matchIntent(trimmedInput, type);

      if (match.matched && match.confidence > (bestMatch?.confidence || 0)) {
        bestMatch = {
          type,
          confidence: match.confidence,
          entities: extractEntities(trimmedInput),
          raw: input,
          matchedPattern: match.pattern,
        };
      }
    }

    // If regex confidence is low and LLM provider is available, try LLM classification
    if ((!bestMatch || bestMatch.confidence < LLM_FALLBACK_THRESHOLD) && hasLLMProvider()) {
      const llmResult = await getLLMClassifier().classify(trimmedInput);

      if (llmResult) {
        // Combine regex and LLM scores if regex had a match
        if (bestMatch && bestMatch.type === llmResult.intent) {
          // Both methods agree - boost confidence
          const combinedConfidence = Math.min(
            1,
            (bestMatch.confidence + llmResult.confidence) / 2 + 0.1,
          );
          return {
            type: llmResult.intent,
            confidence: combinedConfidence,
            entities: extractEntities(trimmedInput),
            raw: input,
            matchedPattern: bestMatch.matchedPattern,
          };
        } else if (llmResult.confidence > (bestMatch?.confidence || 0)) {
          // LLM has higher confidence than regex
          return {
            type: llmResult.intent,
            confidence: llmResult.confidence,
            entities: extractEntities(trimmedInput),
            raw: input,
          };
        }
      }
    }

    // If no good match, fallback to chat
    if (!bestMatch || bestMatch.confidence < fullConfig.minConfidence) {
      return {
        type: "chat",
        confidence: bestMatch?.confidence || 0.3,
        entities: extractEntities(trimmedInput),
        raw: input,
      };
    }

    return bestMatch;
  }

  /**
   * Check if intent should be auto-executed
   */
  function shouldAutoExecute(intent: Intent): boolean {
    // Never auto-execute if in alwaysConfirm list
    if (fullConfig.alwaysConfirm.includes(intent.type)) {
      return false;
    }

    // Check user preference for this intent type
    if (intent.type in fullConfig.autoExecutePreferences) {
      return fullConfig.autoExecutePreferences[intent.type]!;
    }

    // Check global auto-execute setting
    if (!fullConfig.autoExecute) {
      return false;
    }

    // Check confidence threshold
    return intent.confidence >= fullConfig.autoExecuteThreshold;
  }

  /**
   * Convert intent to slash command
   */
  function intentToCommand(intent: Intent): { command: string; args: string[] } | null {
    const args: string[] = [];

    switch (intent.type) {
      case "plan":
        if (intent.entities.flags?.includes("dry-run")) {
          args.push("--dry-run");
        }
        return { command: "plan", args };

      case "build":
        if (intent.entities.sprint !== undefined) {
          args.push(`--sprint=${intent.entities.sprint}`);
        }
        return { command: "build", args };

      case "task":
        if (intent.entities.taskId) {
          args.push(intent.entities.taskId);
        } else if (intent.entities.args?.[0]) {
          args.push(intent.entities.args[0]);
        }
        return { command: "task", args };

      case "init":
        if (intent.entities.projectName) {
          args.push(intent.entities.projectName);
        } else if (intent.entities.args?.[0]) {
          args.push(intent.entities.args[0]);
        }
        if (intent.entities.flags?.includes("yes")) {
          args.push("--yes");
        }
        return { command: "init", args };

      case "output":
        if (intent.entities.flags?.includes("ci")) {
          args.push("--ci");
        }
        if (intent.entities.flags?.includes("docs")) {
          args.push("--docs");
        }
        return { command: "output", args };

      case "status":
        return { command: "status", args };

      case "trust":
        return { command: "trust", args: ["status"] };

      case "help":
        return { command: "help", args };

      case "exit":
        return { command: "exit", args };

      default:
        return null;
    }
  }

  /**
   * Resolve intent to action
   */
  async function resolve(intent: Intent): Promise<IntentResolution> {
    // Check if should auto-execute
    if (shouldAutoExecute(intent)) {
      const cmd = intentToCommand(intent);
      if (cmd) {
        return {
          execute: true,
          command: cmd.command,
          args: cmd.args,
        };
      }
    }

    // For chat intents, never execute as command
    if (intent.type === "chat") {
      return { execute: false };
    }

    // For other intents, suggest execution but don't auto-run
    const cmd = intentToCommand(intent);
    if (cmd && intent.confidence >= fullConfig.minConfidence) {
      return {
        execute: false, // Will need user confirmation
        command: cmd.command,
        args: cmd.args,
      };
    }

    return { execute: false };
  }

  /**
   * Update auto-execute preference for an intent type
   */
  function setAutoExecutePreference(type: IntentType, autoExecute: boolean): void {
    fullConfig.autoExecutePreferences[type] = autoExecute;
  }

  return {
    recognize,
    resolve,
    shouldAutoExecute,
    intentToCommand,
    setAutoExecutePreference,
    getConfig: () => fullConfig,
  };
}

/**
 * Singleton recognizer instance
 */
let globalRecognizer: ReturnType<typeof createIntentRecognizer> | null = null;

/**
 * Get or create global intent recognizer
 */
export function getIntentRecognizer(
  config?: Partial<IntentConfig>,
): ReturnType<typeof createIntentRecognizer> {
  if (!globalRecognizer || config) {
    globalRecognizer = createIntentRecognizer(config);
  }
  return globalRecognizer;
}

/**
 * Set the LLM provider for intent classification fallback
 *
 * @param provider - LLM provider instance to use when regex confidence is low
 */
export function setLLMProvider(provider: LLMProvider): void {
  setClassifierProvider(provider);
}

/**
 * Check if an LLM provider is configured for fallback classification
 */
export function isLLMProviderConfigured(): boolean {
  return hasLLMProvider();
}
