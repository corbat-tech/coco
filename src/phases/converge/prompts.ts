/**
 * Prompts for the CONVERGE phase
 *
 * These prompts guide the LLM in requirement discovery and specification generation
 */

/**
 * System prompt for the discovery agent
 */
export const DISCOVERY_SYSTEM_PROMPT = `You are a senior software architect and requirements analyst. Your role is to help gather and clarify requirements for software projects.

Your goals:
1. Understand what the user wants to build
2. Extract clear, actionable requirements
3. Identify ambiguities and ask clarifying questions
4. Make reasonable assumptions when appropriate
5. Recommend technology choices when needed

Guidelines:
- Be thorough but not overwhelming
- Ask focused, specific questions
- Group related questions together
- Prioritize questions by importance
- Make assumptions for minor details
- Always explain your reasoning

You communicate in a professional but friendly manner. You use concrete examples to clarify abstract requirements.`;

/**
 * Prompt for initial analysis of user input
 */
export const INITIAL_ANALYSIS_PROMPT = `Analyze the following project description and extract:

1. **Project Type**: What kind of software is this? (CLI, API, web app, library, service, etc.)
2. **Complexity**: How complex is this project? (simple, moderate, complex, enterprise)
3. **Completeness**: How complete is the description? (0-100%)
4. **Functional Requirements**: What should the system do?
5. **Non-Functional Requirements**: Performance, security, scalability needs
6. **Technical Constraints**: Any specified technologies or limitations
7. **Assumptions**: What must we assume to proceed?
8. **Critical Questions**: What must be clarified before proceeding?
9. **Technology Recommendations**: What tech stack would you recommend?

User's project description:
---
{{userInput}}
---

Respond in JSON format:
{
  "projectType": "string",
  "complexity": "simple|moderate|complex|enterprise",
  "completeness": number,
  "requirements": [
    {
      "category": "functional|non_functional|technical|constraint",
      "priority": "must_have|should_have|could_have|wont_have",
      "title": "string",
      "description": "string",
      "explicit": boolean,
      "acceptanceCriteria": ["string"]
    }
  ],
  "assumptions": [
    {
      "category": "string",
      "statement": "string",
      "confidence": "high|medium|low",
      "impactIfWrong": "string"
    }
  ],
  "questions": [
    {
      "category": "clarification|expansion|decision|confirmation|scope|priority",
      "question": "string",
      "context": "string",
      "importance": "critical|important|helpful",
      "options": ["string"] | null
    }
  ],
  "techRecommendations": [
    {
      "area": "language|framework|database|infrastructure|testing|ci_cd",
      "decision": "string",
      "alternatives": ["string"],
      "rationale": "string"
    }
  ]
}`;

/**
 * Prompt for generating follow-up questions
 */
export const GENERATE_QUESTIONS_PROMPT = `Based on the current requirements and conversation, generate follow-up questions to clarify the project scope.

Current Requirements:
{{requirements}}

Previous Clarifications:
{{clarifications}}

Open Assumptions:
{{assumptions}}

Generate 1-3 focused questions that will:
1. Clarify the most important ambiguities
2. Confirm critical assumptions
3. Expand on underspecified areas

Prioritize questions by:
- Critical: Blocks further progress
- Important: Significantly affects design
- Helpful: Nice to know for completeness

Respond in JSON format:
{
  "questions": [
    {
      "category": "clarification|expansion|decision|confirmation|scope|priority",
      "question": "string",
      "context": "Why this matters",
      "importance": "critical|important|helpful",
      "defaultAnswer": "string | null",
      "options": ["string"] | null
    }
  ],
  "reasoning": "string"
}`;

/**
 * Prompt for processing user answers
 */
export const PROCESS_ANSWER_PROMPT = `The user answered a clarification question. Update the requirements based on their response.

Question Asked:
{{question}}

User's Answer:
{{answer}}

Current Requirements:
{{requirements}}

Determine:
1. Which requirements are affected by this answer
2. Whether new requirements should be added
3. Whether any requirements should be modified
4. Whether any assumptions can now be confirmed

Respond in JSON format:
{
  "affectedRequirements": ["requirement_id"],
  "modifications": [
    {
      "requirementId": "string",
      "change": "string",
      "newValue": "any"
    }
  ],
  "newRequirements": [
    {
      "category": "functional|non_functional|technical|constraint",
      "priority": "must_have|should_have|could_have|wont_have",
      "title": "string",
      "description": "string",
      "acceptanceCriteria": ["string"]
    }
  ],
  "confirmedAssumptions": ["assumption_id"],
  "reasoning": "string"
}`;

/**
 * Prompt for generating the specification document
 */
export const GENERATE_SPEC_PROMPT = `Generate a comprehensive project specification based on the gathered requirements.

Project Information:
- Name: {{projectName}}
- Type: {{projectType}}
- Complexity: {{complexity}}

Functional Requirements:
{{functionalRequirements}}

Non-Functional Requirements:
{{nonFunctionalRequirements}}

Technical Constraints:
{{technicalConstraints}}

Technology Decisions:
{{techDecisions}}

Confirmed Assumptions:
{{confirmedAssumptions}}

Unconfirmed Assumptions:
{{unconfirmedAssumptions}}

Generate a specification document that includes:

1. **Executive Summary**: Brief overview of the project
2. **Goals & Success Criteria**: What success looks like
3. **Target Users**: Who will use this
4. **Functional Requirements**: Detailed functional needs
5. **Non-Functional Requirements**: Performance, security, etc.
6. **Technical Architecture**: High-level architecture
7. **Technology Stack**: Chosen technologies with rationale
8. **Integrations**: External systems
9. **Assumptions & Risks**: What we're assuming and potential risks
10. **Out of Scope**: What we're NOT building
11. **Open Questions**: Any remaining uncertainties

Format the specification in Markdown with clear sections and subsections.`;

/**
 * Prompt for extracting requirements from conversation
 */
export const EXTRACT_REQUIREMENTS_PROMPT = `Extract requirements from the following conversation message.

Message:
{{message}}

Existing Requirements:
{{existingRequirements}}

Identify:
1. New explicit requirements stated by the user
2. Implicit requirements that can be inferred
3. Requirements that modify or contradict existing ones
4. Technology preferences or constraints mentioned

Respond in JSON format:
{
  "newRequirements": [
    {
      "category": "functional|non_functional|technical|constraint",
      "priority": "must_have|should_have|could_have|wont_have",
      "title": "string",
      "description": "string",
      "explicit": boolean,
      "acceptanceCriteria": ["string"]
    }
  ],
  "modifiedRequirements": [
    {
      "id": "string",
      "modification": "string"
    }
  ],
  "techPreferences": [
    {
      "area": "language|framework|database|infrastructure",
      "preference": "string",
      "reason": "string"
    }
  ]
}`;

/**
 * Prompt for complexity assessment
 */
export const COMPLEXITY_ASSESSMENT_PROMPT = `Assess the complexity of implementing this project.

Project Description:
{{projectDescription}}

Requirements Count:
- Functional: {{functionalCount}}
- Non-Functional: {{nonFunctionalCount}}
- Integrations: {{integrationCount}}

Consider:
1. Number of distinct features
2. Integration complexity
3. Security requirements
4. Scalability needs
5. Domain complexity
6. Technology stack complexity

Provide an assessment:

{
  "complexity": "simple|moderate|complex|enterprise",
  "estimatedEpics": number,
  "estimatedStories": number,
  "estimatedTasks": number,
  "mainChallenges": ["string"],
  "riskAreas": ["string"],
  "reasoning": "string"
}`;

/**
 * Prompt for architecture recommendation
 */
export const ARCHITECTURE_PROMPT = `Recommend an architecture for this project.

Project Type: {{projectType}}
Complexity: {{complexity}}
Requirements:
{{requirements}}

Technology Stack:
{{techStack}}

Consider:
1. Scalability needs
2. Maintainability
3. Team size (assumed: 1 developer + AI)
4. Deployment target
5. Future extensibility

Recommend:
1. Overall architecture pattern (layered, hexagonal, microservices, etc.)
2. Key components and their responsibilities
3. Data flow between components
4. External integrations approach
5. Testing strategy alignment

Respond in JSON format:
{
  "pattern": "string",
  "rationale": "string",
  "components": [
    {
      "name": "string",
      "responsibility": "string",
      "technology": "string"
    }
  ],
  "dataFlow": "string description",
  "integrationApproach": "string",
  "testingStrategy": "string",
  "diagramMermaid": "string (mermaid diagram code)"
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

/**
 * Create a conversation message for the LLM
 */
export function createMessage(
  role: "system" | "user" | "assistant",
  content: string
): { role: "system" | "user" | "assistant"; content: string } {
  return { role, content };
}

/**
 * Build the conversation history for the LLM
 */
export function buildConversation(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [createMessage("system", systemPrompt), ...messages];
}
