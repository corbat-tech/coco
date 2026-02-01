/**
 * Prompts for the ORCHESTRATE phase
 *
 * These prompts guide the LLM in architecture design, ADR creation, and backlog generation
 */

/**
 * System prompt for the architect agent
 */
export const ARCHITECT_SYSTEM_PROMPT = `You are a senior software architect with expertise in designing scalable, maintainable systems.

Your responsibilities:
1. Design clear, modular architectures
2. Document key decisions with ADRs
3. Create actionable development plans
4. Consider quality attributes (performance, security, maintainability)
5. Apply appropriate design patterns

Guidelines:
- Favor simplicity over complexity
- Design for change and extensibility
- Consider trade-offs explicitly
- Document assumptions and risks
- Use industry-standard patterns when appropriate

You produce structured, well-documented architectural artifacts.`;

/**
 * Prompt for generating architecture
 */
export const GENERATE_ARCHITECTURE_PROMPT = `Based on the project specification, design a comprehensive software architecture.

Project Specification:
{{specification}}

Technology Stack:
{{techStack}}

Requirements Summary:
- Functional: {{functionalCount}} requirements
- Non-Functional: {{nonFunctionalCount}} requirements
- Constraints: {{constraintCount}} constraints

Generate an architecture that:
1. Addresses all functional requirements
2. Satisfies non-functional requirements
3. Respects technical constraints
4. Is appropriately complex for the project scope

Respond in JSON format:
{
  "overview": {
    "pattern": "layered|hexagonal|clean|microservices|event_driven|cqrs|modular_monolith|serverless",
    "description": "string",
    "principles": ["string"],
    "qualityAttributes": [
      {
        "name": "string",
        "description": "string",
        "priority": "high|medium|low",
        "tradeoffs": ["string"]
      }
    ]
  },
  "components": [
    {
      "id": "string",
      "name": "string",
      "type": "service|controller|repository|adapter|port|domain|usecase|utility|external",
      "description": "string",
      "responsibilities": ["string"],
      "technology": "string",
      "layer": "string",
      "dependencies": ["component_id"]
    }
  ],
  "relationships": [
    {
      "from": "component_id",
      "to": "component_id",
      "type": "uses|implements|extends|depends|calls|publishes|subscribes",
      "description": "string"
    }
  ],
  "dataModels": [
    {
      "name": "string",
      "description": "string",
      "fields": [
        {
          "name": "string",
          "type": "string",
          "required": true,
          "description": "string"
        }
      ],
      "relationships": [
        {
          "type": "one_to_one|one_to_many|many_to_many",
          "target": "model_name",
          "description": "string"
        }
      ]
    }
  ],
  "integrations": [
    {
      "name": "string",
      "type": "rest_api|graphql|grpc|database|message_queue|file_system|external_service",
      "description": "string",
      "endpoint": "string",
      "authentication": "string"
    }
  ],
  "reasoning": "string"
}`;

/**
 * Prompt for generating C4 diagrams
 */
export const GENERATE_C4_DIAGRAMS_PROMPT = `Generate C4 model diagrams for the architecture.

Architecture Overview:
{{architecture}}

Generate Mermaid diagrams for:
1. Context diagram (system and external actors)
2. Container diagram (deployable units)
3. Component diagram (key components within containers)

Respond in JSON format:
{
  "diagrams": [
    {
      "id": "c4_context",
      "type": "c4_context",
      "title": "System Context Diagram",
      "description": "string",
      "mermaid": "C4Context\\n..."
    },
    {
      "id": "c4_container",
      "type": "c4_container",
      "title": "Container Diagram",
      "description": "string",
      "mermaid": "C4Container\\n..."
    },
    {
      "id": "c4_component",
      "type": "c4_component",
      "title": "Component Diagram",
      "description": "string",
      "mermaid": "C4Component\\n..."
    }
  ]
}`;

/**
 * Prompt for generating sequence diagrams
 */
export const GENERATE_SEQUENCE_DIAGRAMS_PROMPT = `Generate sequence diagrams for key user flows.

Architecture:
{{architecture}}

Key Functional Requirements:
{{functionalRequirements}}

Generate sequence diagrams for the 3-5 most important user flows.

Respond in JSON format:
{
  "diagrams": [
    {
      "id": "string",
      "type": "sequence",
      "title": "string",
      "description": "string",
      "mermaid": "sequenceDiagram\\n..."
    }
  ]
}`;

/**
 * Prompt for generating ADRs
 */
export const GENERATE_ADRS_PROMPT = `Generate Architecture Decision Records for key decisions.

Architecture:
{{architecture}}

Technology Stack:
{{techStack}}

Identify the {{maxADRs}} most important architectural decisions and document them as ADRs.

Include ADRs for:
1. Core architecture pattern choice
2. Major technology selections
3. Security approach
4. Data storage strategy
5. Integration patterns
6. Testing strategy
7. Deployment approach

Respond in JSON format:
{
  "adrs": [
    {
      "number": 1,
      "title": "string",
      "status": "accepted",
      "context": "Detailed context explaining the situation and problem",
      "decision": "Clear statement of the decision made",
      "consequences": {
        "positive": ["string"],
        "negative": ["string"],
        "neutral": ["string"]
      },
      "alternatives": [
        {
          "option": "string",
          "pros": ["string"],
          "cons": ["string"],
          "reason": "Why not chosen"
        }
      ],
      "references": ["string"]
    }
  ]
}`;

/**
 * Prompt for generating backlog
 */
export const GENERATE_BACKLOG_PROMPT = `Create a complete development backlog from the architecture and requirements.

Architecture:
{{architecture}}

Requirements:
{{requirements}}

Breakdown Strategy: {{breakdownStrategy}}

Generate a backlog with:
1. Epics (major features or components)
2. User Stories (deliverable increments)
3. Tasks (atomic work items)

Follow these guidelines:
- Each task should be completable in 1-4 hours
- Include tests for each feature task
- Order by dependency and priority
- Include infrastructure/setup tasks
- Include documentation tasks

Respond in JSON format:
{
  "epics": [
    {
      "id": "epic_001",
      "title": "string",
      "description": "string",
      "priority": 1-5,
      "dependencies": ["epic_id"],
      "status": "planned"
    }
  ],
  "stories": [
    {
      "id": "story_001",
      "epicId": "epic_001",
      "title": "string",
      "asA": "role",
      "iWant": "feature",
      "soThat": "benefit",
      "acceptanceCriteria": ["string"],
      "points": 1|2|3|5|8|13,
      "status": "backlog"
    }
  ],
  "tasks": [
    {
      "id": "task_001",
      "storyId": "story_001",
      "title": "string",
      "description": "string",
      "type": "feature|test|refactor|docs|infra|config",
      "files": ["expected/file/paths"],
      "dependencies": ["task_id"],
      "estimatedComplexity": "trivial|simple|moderate|complex",
      "status": "pending"
    }
  ],
  "estimatedSprints": number,
  "warnings": ["string"]
}`;

/**
 * Prompt for sprint planning
 */
export const PLAN_SPRINT_PROMPT = `Plan the first sprint from the backlog.

Backlog Summary:
- Epics: {{epicCount}}
- Stories: {{storyCount}}
- Tasks: {{taskCount}}

Sprint Configuration:
- Duration: {{sprintDuration}} days
- Target Velocity: {{targetVelocity}} points
- Max Stories: {{maxStoriesPerSprint}}
- Buffer: {{bufferPercentage}}%

Stories Available:
{{availableStories}}

Select stories for Sprint 1 following these rules:
1. Prioritize foundation/infrastructure stories
2. Respect dependencies
3. Stay within velocity target (with buffer)
4. Ensure a coherent sprint goal

Respond in JSON format:
{
  "sprint": {
    "id": "sprint_001",
    "name": "Sprint 1: Foundation",
    "goal": "string",
    "stories": ["story_id"],
    "plannedPoints": number,
    "status": "planning"
  },
  "reasoning": "string"
}`;

/**
 * Prompt for task estimation
 */
export const ESTIMATE_TASK_PROMPT = `Estimate the complexity of the following task.

Task: {{taskTitle}}
Description: {{taskDescription}}
Type: {{taskType}}
Files: {{taskFiles}}

Consider:
1. Lines of code expected
2. External dependencies
3. Testing requirements
4. Edge cases
5. Integration complexity

Respond in JSON format:
{
  "complexity": "trivial|simple|moderate|complex",
  "reasoning": "string",
  "estimatedLines": number,
  "testingEffort": "minimal|moderate|extensive",
  "risks": ["string"]
}`;

/**
 * Helper to fill prompt templates
 */
export function fillPrompt(
  template: string,
  variables: Record<string, string | number | unknown>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const stringValue =
      typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : JSON.stringify(value, null, 2);

    result = result.replaceAll(placeholder, stringValue);
  }

  return result;
}
