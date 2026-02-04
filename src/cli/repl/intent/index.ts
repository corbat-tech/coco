/**
 * Intent Recognition Module
 *
 * Natural language intent detection for the REPL.
 */

export type {
  Intent,
  IntentType,
  IntentEntities,
  IntentPattern,
  IntentConfig,
  IntentRecognizer,
  IntentResolution,
} from './types.js';

export {
  INTENT_PATTERNS,
  ENTITY_PATTERNS,
  CONFIDENCE,
  calculateConfidenceBoost,
  getPatternsForIntent,
} from './patterns.js';

export {
  createIntentRecognizer,
  getIntentRecognizer,
  DEFAULT_INTENT_CONFIG,
  setLLMProvider,
  isLLMProviderConfigured,
} from './recognizer.js';

// LLM Classifier exports
export {
  LLMIntentClassifier,
  getLLMClassifier,
  hasLLMProvider,
  type LLMClassificationResult,
} from './llm-classifier.js';
