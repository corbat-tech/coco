/**
 * Backlog Generator for the ORCHESTRATE phase
 *
 * Generates epics, stories, tasks, and sprint plans
 */

import { randomUUID } from "node:crypto";
import type {
  BacklogResult,
  OrchestrateConfig,
  ArchitectureDoc,
} from "./types.js";
import type {
  Backlog,
  Epic,
  Story,
  Task,
  Sprint,
  TaskType,
  TaskComplexity,
} from "../../types/task.js";
import type { Specification } from "../converge/types.js";
import type { LLMProvider } from "../../providers/types.js";
import {
  ARCHITECT_SYSTEM_PROMPT,
  GENERATE_BACKLOG_PROMPT,
  PLAN_SPRINT_PROMPT,
  fillPrompt,
} from "./prompts.js";
import { PhaseError } from "../../utils/errors.js";

/**
 * Backlog Generator
 */
export class BacklogGenerator {
  private llm: LLMProvider;
  private config: OrchestrateConfig;

  constructor(llm: LLMProvider, config: OrchestrateConfig) {
    this.llm = llm;
    this.config = config;
  }

  /**
   * Generate complete backlog from architecture and specification
   */
  async generate(
    architecture: ArchitectureDoc,
    specification: Specification
  ): Promise<BacklogResult> {
    const prompt = fillPrompt(GENERATE_BACKLOG_PROMPT, {
      architecture: JSON.stringify({
        pattern: architecture.overview.pattern,
        components: architecture.components.map((c) => c.name),
        dataModels: architecture.dataModels.map((d) => d.name),
      }),
      requirements: JSON.stringify({
        functional: specification.requirements.functional.map((r) => ({
          title: r.title,
          priority: r.priority,
        })),
        nonFunctional: specification.requirements.nonFunctional.map((r) => r.title),
      }),
      breakdownStrategy: this.config.breakdownStrategy,
    });

    const response = await this.llm.chat([
      { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    try {
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        epics?: Array<{
          id?: string;
          title?: string;
          description?: string;
          priority?: number;
          dependencies?: string[];
          status?: string;
        }>;
        stories?: Array<{
          id?: string;
          epicId?: string;
          title?: string;
          asA?: string;
          iWant?: string;
          soThat?: string;
          acceptanceCriteria?: string[];
          points?: number;
          status?: string;
        }>;
        tasks?: Array<{
          id?: string;
          storyId?: string;
          title?: string;
          description?: string;
          type?: string;
          files?: string[];
          dependencies?: string[];
          estimatedComplexity?: string;
          status?: string;
        }>;
        estimatedSprints?: number;
        warnings?: string[];
      };

      const epics = this.parseEpics(parsed.epics || []);
      const stories = this.parseStories(parsed.stories || []);
      const tasks = this.parseTasks(parsed.tasks || []);

      // Calculate velocity based on configuration
      const totalPoints = stories.reduce((sum, s) => sum + s.points, 0);
      const estimatedSprints =
        parsed.estimatedSprints ||
        Math.ceil(totalPoints / this.config.sprint.targetVelocity);

      return {
        backlog: {
          epics,
          stories,
          tasks,
          currentSprint: null,
          completedSprints: [],
        },
        estimatedSprints,
        estimatedVelocity: this.config.sprint.targetVelocity,
        warnings: parsed.warnings || [],
      };
    } catch {
      throw new PhaseError("Failed to generate backlog", { phase: "orchestrate" });
    }
  }

  /**
   * Plan the first sprint from the backlog
   */
  async planFirstSprint(backlog: Backlog): Promise<Sprint> {
    // Get available stories (ready and not assigned)
    const availableStories = backlog.stories.filter(
      (s) => s.status === "backlog" || s.status === "ready"
    );

    // Check dependencies
    const readyStories = availableStories.filter((story) => {
      const epic = backlog.epics.find((e) => e.id === story.epicId);
      if (!epic) return true;

      // Check if epic dependencies are met
      const depsMet = epic.dependencies.every((depId) => {
        const depEpic = backlog.epics.find((e) => e.id === depId);
        return depEpic?.status === "done";
      });

      return depsMet || epic.dependencies.length === 0;
    });

    const prompt = fillPrompt(PLAN_SPRINT_PROMPT, {
      epicCount: backlog.epics.length,
      storyCount: backlog.stories.length,
      taskCount: backlog.tasks.length,
      sprintDuration: this.config.sprint.sprintDuration,
      targetVelocity: this.config.sprint.targetVelocity,
      maxStoriesPerSprint: this.config.sprint.maxStoriesPerSprint,
      bufferPercentage: this.config.sprint.bufferPercentage,
      availableStories: JSON.stringify(
        readyStories.slice(0, 20).map((s) => ({
          id: s.id,
          title: s.title,
          points: s.points,
          epicId: s.epicId,
        }))
      ),
    });

    try {
      const response = await this.llm.chat([
        { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          sprint?: {
            id?: string;
            name?: string;
            goal?: string;
            stories?: string[];
            plannedPoints?: number;
            status?: string;
          };
        };

        if (parsed.sprint) {
          return {
            id: parsed.sprint.id || `sprint_${randomUUID().substring(0, 8)}`,
            name: parsed.sprint.name || "Sprint 1",
            goal: parsed.sprint.goal || "Initial foundation",
            startDate: new Date(),
            stories: parsed.sprint.stories || [],
            status: "planning",
          };
        }
      }

      // Fallback: auto-select stories
      return this.autoSelectSprint(backlog, readyStories);
    } catch {
      return this.autoSelectSprint(backlog, readyStories);
    }
  }

  /**
   * Auto-select stories for a sprint based on priority and velocity
   */
  private autoSelectSprint(backlog: Backlog, availableStories: Story[]): Sprint {
    const targetVelocity = this.config.sprint.targetVelocity;
    const bufferFactor = 1 - this.config.sprint.bufferPercentage / 100;
    const maxPoints = targetVelocity * bufferFactor;

    // Sort by priority (from epic) and then by points
    const sorted = [...availableStories].sort((a, b) => {
      const epicA = backlog.epics.find((e) => e.id === a.epicId);
      const epicB = backlog.epics.find((e) => e.id === b.epicId);
      const priorityDiff = (epicA?.priority || 5) - (epicB?.priority || 5);
      if (priorityDiff !== 0) return priorityDiff;
      return a.points - b.points;
    });

    const selectedStories: string[] = [];
    let currentPoints = 0;

    for (const story of sorted) {
      if (selectedStories.length >= this.config.sprint.maxStoriesPerSprint) break;
      if (currentPoints + story.points > maxPoints) continue;

      selectedStories.push(story.id);
      currentPoints += story.points;
    }

    return {
      id: `sprint_${randomUUID().substring(0, 8)}`,
      name: "Sprint 1: Foundation",
      goal: "Set up project foundation and core infrastructure",
      startDate: new Date(),
      stories: selectedStories,
      status: "planning",
    };
  }

  // Parse helpers

  private parseEpics(
    data: Array<{
      id?: string;
      title?: string;
      description?: string;
      priority?: number;
      dependencies?: string[];
      status?: string;
    }>
  ): Epic[] {
    return data.map((e) => ({
      id: e.id || `epic_${randomUUID().substring(0, 8)}`,
      title: e.title || "Epic",
      description: e.description || "",
      stories: [],
      priority: (e.priority as Epic["priority"]) || 3,
      dependencies: e.dependencies || [],
      status: (e.status as Epic["status"]) || "planned",
    }));
  }

  private parseStories(
    data: Array<{
      id?: string;
      epicId?: string;
      title?: string;
      asA?: string;
      iWant?: string;
      soThat?: string;
      acceptanceCriteria?: string[];
      points?: number;
      status?: string;
    }>
  ): Story[] {
    return data.map((s) => ({
      id: s.id || `story_${randomUUID().substring(0, 8)}`,
      epicId: s.epicId || "",
      title: s.title || "Story",
      asA: s.asA || "user",
      iWant: s.iWant || "",
      soThat: s.soThat || "",
      acceptanceCriteria: s.acceptanceCriteria || [],
      tasks: [],
      points: this.normalizePoints(s.points),
      status: (s.status as Story["status"]) || "backlog",
    }));
  }

  private parseTasks(
    data: Array<{
      id?: string;
      storyId?: string;
      title?: string;
      description?: string;
      type?: string;
      files?: string[];
      dependencies?: string[];
      estimatedComplexity?: string;
      status?: string;
    }>
  ): Task[] {
    return data.map((t) => ({
      id: t.id || `task_${randomUUID().substring(0, 8)}`,
      storyId: t.storyId || "",
      title: t.title || "Task",
      description: t.description || "",
      type: (t.type as TaskType) || "feature",
      files: t.files || [],
      dependencies: t.dependencies || [],
      estimatedComplexity: (t.estimatedComplexity as TaskComplexity) || "simple",
      status: "pending",
    }));
  }

  private normalizePoints(value?: number): Story["points"] {
    const fibonacciPoints = [1, 2, 3, 5, 8, 13];
    if (!value) return 3;
    const closest = fibonacciPoints.reduce((prev, curr) =>
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
    return closest as Story["points"];
  }
}

/**
 * Generate backlog markdown document
 */
export function generateBacklogMarkdown(backlog: Backlog): string {
  const sections: string[] = [];

  // Header
  sections.push("# Project Backlog");
  sections.push("");
  sections.push("## Summary");
  sections.push("");
  sections.push(`- **Epics:** ${backlog.epics.length}`);
  sections.push(`- **Stories:** ${backlog.stories.length}`);
  sections.push(`- **Tasks:** ${backlog.tasks.length}`);
  sections.push(
    `- **Total Points:** ${backlog.stories.reduce((sum, s) => sum + s.points, 0)}`
  );
  sections.push("");

  // Epics
  sections.push("## Epics");
  sections.push("");

  for (const epic of backlog.epics) {
    sections.push(`### ${epic.title}`);
    sections.push("");
    sections.push(`**Priority:** ${epic.priority} | **Status:** ${epic.status}`);
    sections.push("");
    sections.push(epic.description);
    sections.push("");

    // Stories in this epic
    const epicStories = backlog.stories.filter((s) => s.epicId === epic.id);
    if (epicStories.length > 0) {
      sections.push("#### Stories");
      sections.push("");
      sections.push("| ID | Title | Points | Status |");
      sections.push("|----|-------|--------|--------|");
      for (const story of epicStories) {
        sections.push(
          `| ${story.id} | ${story.title} | ${story.points} | ${story.status} |`
        );
      }
      sections.push("");
    }
  }

  // Detailed Stories
  sections.push("## Story Details");
  sections.push("");

  for (const story of backlog.stories) {
    sections.push(`### ${story.title}`);
    sections.push("");
    sections.push(`**As a** ${story.asA}`);
    sections.push(`**I want** ${story.iWant}`);
    sections.push(`**So that** ${story.soThat}`);
    sections.push("");
    sections.push(`**Points:** ${story.points} | **Status:** ${story.status}`);
    sections.push("");

    if (story.acceptanceCriteria.length > 0) {
      sections.push("**Acceptance Criteria:**");
      for (const ac of story.acceptanceCriteria) {
        sections.push(`- [ ] ${ac}`);
      }
      sections.push("");
    }

    // Tasks for this story
    const storyTasks = backlog.tasks.filter((t) => t.storyId === story.id);
    if (storyTasks.length > 0) {
      sections.push("**Tasks:**");
      sections.push("");
      sections.push("| ID | Title | Type | Complexity |");
      sections.push("|----|-------|------|------------|");
      for (const task of storyTasks) {
        sections.push(
          `| ${task.id} | ${task.title} | ${task.type} | ${task.estimatedComplexity} |`
        );
      }
      sections.push("");
    }
  }

  sections.push("---");
  sections.push("");
  sections.push("*Generated by Corbat-Coco*");

  return sections.join("\n");
}

/**
 * Generate sprint markdown document
 */
export function generateSprintMarkdown(sprint: Sprint, backlog: Backlog): string {
  const sections: string[] = [];

  sections.push(`# ${sprint.name}`);
  sections.push("");
  sections.push(`**Start Date:** ${sprint.startDate.toISOString().split("T")[0]}`);
  sections.push(`**Status:** ${sprint.status}`);
  sections.push("");
  sections.push("## Goal");
  sections.push("");
  sections.push(sprint.goal);
  sections.push("");

  // Stories in sprint
  const sprintStories = backlog.stories.filter((s) =>
    sprint.stories.includes(s.id)
  );

  const totalPoints = sprintStories.reduce((sum, s) => sum + s.points, 0);

  sections.push("## Stories");
  sections.push("");
  sections.push(`**Total Points:** ${totalPoints}`);
  sections.push("");
  sections.push("| Story | Points | Status |");
  sections.push("|-------|--------|--------|");

  for (const story of sprintStories) {
    sections.push(`| ${story.title} | ${story.points} | ${story.status} |`);
  }
  sections.push("");

  // Tasks breakdown
  sections.push("## Tasks");
  sections.push("");

  for (const story of sprintStories) {
    const storyTasks = backlog.tasks.filter((t) => t.storyId === story.id);
    if (storyTasks.length > 0) {
      sections.push(`### ${story.title}`);
      sections.push("");
      for (const task of storyTasks) {
        const checkbox = task.status === "completed" ? "[x]" : "[ ]";
        sections.push(`- ${checkbox} ${task.title} (${task.type})`);
      }
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * Create a backlog generator
 */
export function createBacklogGenerator(
  llm: LLMProvider,
  config: OrchestrateConfig
): BacklogGenerator {
  return new BacklogGenerator(llm, config);
}
