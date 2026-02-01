/**
 * Discovery Engine for the CONVERGE phase
 *
 * Handles requirement gathering through conversation with the user
 */

import { randomUUID } from "node:crypto";
import type {
  DiscoverySession,
  DiscoveryMessage,
  DiscoveryConfig,
  Requirement,
  Question,
  TechDecision,
  Clarification,
  InputAnalysis,
  ProjectType,
} from "./types.js";
import {
  DISCOVERY_SYSTEM_PROMPT,
  INITIAL_ANALYSIS_PROMPT,
  GENERATE_QUESTIONS_PROMPT,
  PROCESS_ANSWER_PROMPT,
  EXTRACT_REQUIREMENTS_PROMPT,
  fillPrompt,
} from "./prompts.js";
import type { LLMProvider } from "../../providers/types.js";
import { PhaseError } from "../../utils/errors.js";

// Import parsers
import {
  normalizeComplexity,
  parseRequirements,
  parseQuestions,
  parseAssumptions,
  parseTechHints,
} from "./discovery-parsers.js";

/**
 * Default discovery configuration
 */
export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  maxQuestionsPerRound: 3,
  minRequirements: 3,
  autoConfirmLowConfidence: false,
  defaultLanguage: "typescript",
  includeDiagrams: true,
};

/**
 * Discovery Engine
 *
 * Manages the requirement discovery process through conversation
 */
export class DiscoveryEngine {
  private session: DiscoverySession | null = null;
  private config: DiscoveryConfig;
  private llm: LLMProvider;

  constructor(llm: LLMProvider, config: Partial<DiscoveryConfig> = {}) {
    this.llm = llm;
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /**
   * Start a new discovery session
   */
  async startSession(initialInput: string): Promise<DiscoverySession> {
    const sessionId = randomUUID();
    const now = new Date();

    this.session = {
      id: sessionId,
      startedAt: now,
      updatedAt: now,
      status: "gathering",
      initialInput,
      conversation: [],
      requirements: [],
      openQuestions: [],
      clarifications: [],
      assumptions: [],
      techDecisions: [],
    };

    // Add the initial input as first message
    this.addMessage("user", initialInput);

    // Analyze the initial input
    const analysis = await this.analyzeInput(initialInput);

    // Apply analysis results
    this.applyAnalysis(analysis);

    // Update status based on analysis
    this.updateSessionStatus();

    return this.session;
  }

  /**
   * Resume an existing session
   */
  resumeSession(session: DiscoverySession): void {
    this.session = session;
  }

  /**
   * Get the current session
   */
  getSession(): DiscoverySession | null {
    return this.session;
  }

  /**
   * Analyze user input for requirements
   */
  async analyzeInput(input: string): Promise<InputAnalysis> {
    const prompt = fillPrompt(INITIAL_ANALYSIS_PROMPT, {
      userInput: input,
    });

    const response = await this.llm.chat([
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        projectType?: string;
        complexity?: string;
        completeness?: number;
        requirements?: Array<{
          category?: string;
          priority?: string;
          title?: string;
          description?: string;
          explicit?: boolean;
          acceptanceCriteria?: string[];
        }>;
        assumptions?: Array<{
          category?: string;
          statement?: string;
          confidence?: string;
          impactIfWrong?: string;
        }>;
        questions?: Array<{
          category?: string;
          question?: string;
          context?: string;
          importance?: string;
          options?: string[] | null;
        }>;
        techRecommendations?: Array<{
          area?: string;
          decision?: string;
          alternatives?: string[];
          rationale?: string;
        }>;
      };

      return {
        projectType: (parsed.projectType as ProjectType) || "unknown",
        complexity: normalizeComplexity(parsed.complexity),
        completeness: parsed.completeness || 0,
        requirements: parseRequirements(parsed.requirements || []),
        suggestedQuestions: parseQuestions(parsed.questions || []),
        assumptions: parseAssumptions(parsed.assumptions || []),
        techHints: parseTechHints(parsed.techRecommendations || []),
      };
    } catch {
      throw new PhaseError(
        "Failed to parse LLM response for input analysis",
        { phase: "converge" }
      );
    }
  }

  /**
   * Process a user's answer to a question
   */
  async processAnswer(questionId: string, answer: string): Promise<void> {
    if (!this.session) {
      throw new PhaseError("No active discovery session", { phase: "converge" });
    }

    const question = this.session.openQuestions.find((q) => q.id === questionId);
    if (!question) {
      throw new PhaseError(`Question not found: ${questionId}`, { phase: "converge" });
    }

    // Mark question as answered
    question.asked = true;
    question.answer = answer;

    // Add to conversation
    this.addMessage("user", answer);

    // Process the answer
    const prompt = fillPrompt(PROCESS_ANSWER_PROMPT, {
      question: JSON.stringify(question),
      answer,
      requirements: JSON.stringify(this.session.requirements),
    });

    const response = await this.llm.chat([
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        affectedRequirements?: string[];
        modifications?: Array<{
          requirementId: string;
          change: string;
          newValue?: unknown;
        }>;
        newRequirements?: Array<{
          category?: string;
          priority?: string;
          title?: string;
          description?: string;
          acceptanceCriteria?: string[];
        }>;
        confirmedAssumptions?: string[];
      };

      // Apply modifications
      if (parsed.modifications) {
        for (const mod of parsed.modifications) {
          const req = this.session.requirements.find(
            (r) => r.id === mod.requirementId
          );
          if (req && mod.change === "description" && typeof mod.newValue === "string") {
            req.description = mod.newValue;
          }
        }
      }

      // Add new requirements
      if (parsed.newRequirements) {
        const newReqs = parseRequirements(parsed.newRequirements);
        for (const req of newReqs) {
          req.sourceMessageId = this.session.conversation[
            this.session.conversation.length - 1
          ]?.id || "";
          this.session.requirements.push(req);
        }
      }

      // Confirm assumptions
      if (parsed.confirmedAssumptions) {
        for (const assumptionId of parsed.confirmedAssumptions) {
          const assumption = this.session.assumptions.find(
            (a) => a.id === assumptionId
          );
          if (assumption) {
            assumption.confirmed = true;
          }
        }
      }

      // Record clarification
      const clarification: Clarification = {
        questionId,
        answer,
        timestamp: new Date(),
        affectedRequirements: parsed.affectedRequirements || [],
        newRequirements: parsed.newRequirements?.map((r) => r.title || "") || [],
      };
      this.session.clarifications.push(clarification);

      // Remove answered question from open questions
      this.session.openQuestions = this.session.openQuestions.filter(
        (q) => q.id !== questionId
      );

      // Update session
      this.session.updatedAt = new Date();
      this.updateSessionStatus();
    } catch {
      throw new PhaseError("Failed to process answer", { phase: "converge" });
    }
  }

  /**
   * Generate follow-up questions based on current state
   */
  async generateQuestions(): Promise<Question[]> {
    if (!this.session) {
      throw new PhaseError("No active discovery session", { phase: "converge" });
    }

    const prompt = fillPrompt(GENERATE_QUESTIONS_PROMPT, {
      requirements: JSON.stringify(this.session.requirements),
      clarifications: JSON.stringify(this.session.clarifications),
      assumptions: JSON.stringify(
        this.session.assumptions.filter((a) => !a.confirmed)
      ),
    });

    const response = await this.llm.chat([
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        questions?: Array<{
          category?: string;
          question?: string;
          context?: string;
          importance?: string;
          defaultAnswer?: string | null;
          options?: string[] | null;
        }>;
      };

      const questions = parseQuestions(parsed.questions || []);

      // Limit to max questions per round
      const limited = questions.slice(0, this.config.maxQuestionsPerRound);

      // Add to open questions
      for (const q of limited) {
        if (!this.session.openQuestions.some((oq) => oq.question === q.question)) {
          this.session.openQuestions.push(q);
        }
      }

      return limited;
    } catch {
      throw new PhaseError("Failed to generate questions", { phase: "converge" });
    }
  }

  /**
   * Process a free-form message from the user
   */
  async processMessage(message: string): Promise<{
    newRequirements: Requirement[];
    questions: Question[];
  }> {
    if (!this.session) {
      throw new PhaseError("No active discovery session", { phase: "converge" });
    }

    // Add to conversation
    this.addMessage("user", message);

    // Extract requirements from the message
    const prompt = fillPrompt(EXTRACT_REQUIREMENTS_PROMPT, {
      message,
      existingRequirements: JSON.stringify(this.session.requirements),
    });

    const response = await this.llm.chat([
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        newRequirements?: Array<{
          category?: string;
          priority?: string;
          title?: string;
          description?: string;
          explicit?: boolean;
          acceptanceCriteria?: string[];
        }>;
        techPreferences?: Array<{
          area?: string;
          preference?: string;
          reason?: string;
        }>;
      };

      // Add new requirements
      const newReqs = parseRequirements(parsed.newRequirements || []);
      const lastMsgId =
        this.session.conversation[this.session.conversation.length - 1]?.id || "";
      for (const req of newReqs) {
        req.sourceMessageId = lastMsgId;
        this.session.requirements.push(req);
      }

      // Process tech preferences
      if (parsed.techPreferences) {
        for (const pref of parsed.techPreferences) {
          if (pref.area && pref.preference) {
            const existing = this.session.techDecisions.find(
              (t) => t.area === pref.area
            );
            if (!existing) {
              this.session.techDecisions.push({
                id: randomUUID(),
                area: pref.area as TechDecision["area"],
                decision: pref.preference,
                alternatives: [],
                rationale: pref.reason || "",
                explicit: true,
              });
            }
          }
        }
      }

      // Update session
      this.session.updatedAt = new Date();
      this.updateSessionStatus();

      // Generate follow-up questions if needed
      let questions: Question[] = [];
      if (this.session.status === "clarifying") {
        questions = await this.generateQuestions();
      }

      return { newRequirements: newReqs, questions };
    } catch {
      throw new PhaseError("Failed to process message", { phase: "converge" });
    }
  }

  /**
   * Check if discovery is complete
   */
  isComplete(): boolean {
    if (!this.session) return false;

    return (
      this.session.status === "complete" ||
      this.session.status === "spec_generated"
    );
  }

  /**
   * Get unanswered questions
   */
  getOpenQuestions(): Question[] {
    if (!this.session) return [];
    return this.session.openQuestions.filter((q) => !q.asked);
  }

  /**
   * Get critical questions that must be answered
   */
  getCriticalQuestions(): Question[] {
    return this.getOpenQuestions().filter((q) => q.importance === "critical");
  }

  /**
   * Mark discovery as complete
   */
  markComplete(): void {
    if (!this.session) {
      throw new PhaseError("No active discovery session", { phase: "converge" });
    }
    this.session.status = "complete";
    this.session.updatedAt = new Date();
  }

  /**
   * Force complete with current requirements
   */
  forceComplete(): void {
    if (!this.session) {
      throw new PhaseError("No active discovery session", { phase: "converge" });
    }

    // Auto-confirm low confidence assumptions if configured
    if (this.config.autoConfirmLowConfidence) {
      for (const assumption of this.session.assumptions) {
        if (!assumption.confirmed && assumption.confidence !== "high") {
          assumption.confirmed = true;
        }
      }
    }

    this.session.status = "complete";
    this.session.updatedAt = new Date();
  }

  // Private helper methods

  private addMessage(role: "user" | "assistant", content: string): void {
    if (!this.session) return;

    const message: DiscoveryMessage = {
      id: randomUUID(),
      timestamp: new Date(),
      role,
      content,
    };

    this.session.conversation.push(message);
    this.session.updatedAt = new Date();
  }

  private applyAnalysis(analysis: InputAnalysis): void {
    if (!this.session) return;

    // Add requirements
    const lastMsgId =
      this.session.conversation[this.session.conversation.length - 1]?.id || "";
    for (const req of analysis.requirements) {
      req.sourceMessageId = lastMsgId;
      this.session.requirements.push(req);
    }

    // Add assumptions
    for (const assumption of analysis.assumptions) {
      this.session.assumptions.push(assumption);
    }

    // Add questions
    for (const question of analysis.suggestedQuestions) {
      this.session.openQuestions.push(question);
    }

    // Add tech decisions
    for (const hint of analysis.techHints) {
      if (hint.area && hint.decision) {
        this.session.techDecisions.push({
          id: randomUUID(),
          area: hint.area,
          decision: hint.decision,
          alternatives: hint.alternatives || [],
          rationale: hint.rationale || "",
          explicit: hint.explicit ?? false,
        });
      }
    }
  }

  private updateSessionStatus(): void {
    if (!this.session) return;

    const hasMinRequirements =
      this.session.requirements.length >= this.config.minRequirements;
    const hasCriticalQuestions = this.getCriticalQuestions().length > 0;
    const hasUnconfirmedHighImpact = this.session.assumptions.some(
      (a) => !a.confirmed && a.confidence === "low"
    );

    if (hasCriticalQuestions || hasUnconfirmedHighImpact) {
      this.session.status = "clarifying";
    } else if (hasMinRequirements) {
      this.session.status = "refining";
    } else {
      this.session.status = "gathering";
    }
  }
}

/**
 * Create a discovery engine with default configuration
 */
export function createDiscoveryEngine(
  llm: LLMProvider,
  config?: Partial<DiscoveryConfig>
): DiscoveryEngine {
  return new DiscoveryEngine(llm, config);
}
