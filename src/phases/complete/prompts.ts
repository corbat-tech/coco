/**
 * Prompts for the COMPLETE phase
 *
 * These prompts guide the LLM in code generation, review, and iteration
 */

/**
 * System prompt for the code generation agent
 */
export const CODE_GENERATION_SYSTEM_PROMPT = `You are a senior software developer with expertise in writing clean, maintainable, well-tested code.

Your responsibilities:
1. Write production-quality code
2. Follow best practices and design patterns
3. Include comprehensive tests
4. Handle errors gracefully
5. Write clear documentation

Quality standards:
- Code must be readable and self-documenting
- Functions should be small and focused
- Error handling must be robust
- Tests should cover edge cases
- Types must be explicit and strict

You produce code that is ready for production deployment.`;

/**
 * System prompt for the code review agent
 */
export const CODE_REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer with expertise in evaluating code quality.

Your responsibilities:
1. Evaluate code against quality standards
2. Identify bugs, vulnerabilities, and issues
3. Suggest improvements
4. Verify test coverage
5. Ensure maintainability

Review criteria:
- Correctness: Does the code work correctly?
- Completeness: Does it fulfill requirements?
- Robustness: Does it handle edge cases?
- Readability: Is it easy to understand?
- Maintainability: Is it easy to modify?
- Security: Are there vulnerabilities?
- Performance: Are there bottlenecks?

You provide constructive, actionable feedback.`;

/**
 * Prompt for generating code
 */
export const GENERATE_CODE_PROMPT = `Generate production-quality code for the following task.

Task: {{taskTitle}}
Description: {{taskDescription}}
Type: {{taskType}}
Expected Files: {{expectedFiles}}

Project Context:
{{projectContext}}

{{previousCodeSection}}

{{feedbackSection}}

Requirements:
1. Write clean, well-structured code
2. Include comprehensive tests (TDD approach)
3. Add appropriate error handling
4. Include necessary documentation
5. Follow the project's coding standards

Respond in JSON format:
{
  "files": [
    {
      "path": "string",
      "content": "string (full file content)",
      "action": "create|modify"
    }
  ],
  "explanation": "Brief explanation of the implementation",
  "confidence": 0-100
}`;

/**
 * Prompt for reviewing code
 */
export const REVIEW_CODE_PROMPT = `Review the following code implementation for quality and correctness.

Task: {{taskTitle}}
Description: {{taskDescription}}

Files to review:
{{filesToReview}}

Test Results:
{{testResults}}

Evaluate against these criteria:
1. Correctness (15%): Does it work correctly?
2. Completeness (10%): Does it fulfill all requirements?
3. Robustness (10%): Does it handle edge cases?
4. Readability (10%): Is the code clear and well-structured?
5. Maintainability (10%): Is it easy to modify?
6. Complexity (8%): Is the complexity appropriate?
7. Duplication (7%): Is there unnecessary duplication?
8. Test Coverage (10%): Are tests comprehensive?
9. Test Quality (5%): Are tests meaningful?
10. Security (8%): Are there security issues?
11. Documentation (4%): Is documentation adequate?
12. Style (3%): Does it follow coding standards?

Respond in JSON format:
{
  "passed": boolean,
  "scores": {
    "correctness": 0-100,
    "completeness": 0-100,
    "robustness": 0-100,
    "readability": 0-100,
    "maintainability": 0-100,
    "complexity": 0-100,
    "duplication": 0-100,
    "testCoverage": 0-100,
    "testQuality": 0-100,
    "security": 0-100,
    "documentation": 0-100,
    "style": 0-100
  },
  "issues": [
    {
      "severity": "critical|major|minor|info",
      "category": "correctness|completeness|robustness|readability|maintainability|complexity|duplication|testCoverage|testQuality|security|documentation|style",
      "message": "string",
      "file": "string (optional)",
      "line": number (optional),
      "suggestion": "string (optional)"
    }
  ],
  "suggestions": [
    {
      "type": "improvement|refactor|test|documentation",
      "description": "string",
      "priority": "high|medium|low",
      "impact": 0-10
    }
  ],
  "summary": "string"
}`;

/**
 * Prompt for improving code based on feedback
 */
export const IMPROVE_CODE_PROMPT = `Improve the code based on the review feedback.

Task: {{taskTitle}}
Iteration: {{iteration}}

Current Implementation:
{{currentCode}}

Review Feedback:
- Score: {{currentScore}}/100
- Issues: {{issueCount}}
- Critical Issues: {{criticalIssues}}

Issues to Address:
{{issues}}

Suggestions to Consider:
{{suggestions}}

Focus on:
1. Fix all critical and major issues
2. Address as many minor issues as practical
3. Implement high-priority suggestions
4. Improve test coverage if below target
5. Maintain or improve readability

Respond in JSON format:
{
  "files": [
    {
      "path": "string",
      "content": "string (full file content)",
      "action": "create|modify"
    }
  ],
  "changesApplied": ["string"],
  "issuesFixed": ["issue_index"],
  "suggestionsImplemented": ["suggestion_index"],
  "explanation": "string",
  "confidence": 0-100
}`;

/**
 * Prompt for generating tests
 */
export const GENERATE_TESTS_PROMPT = `Generate comprehensive tests for the following implementation.

Code to test:
{{codeToTest}}

Requirements:
- Cover all public functions/methods
- Include edge cases
- Test error handling
- Aim for {{targetCoverage}}% coverage

Current coverage:
- Lines: {{lineCoverage}}%
- Branches: {{branchCoverage}}%
- Functions: {{functionCoverage}}%

Respond in JSON format:
{
  "testFiles": [
    {
      "path": "string",
      "content": "string (test file content)"
    }
  ],
  "expectedCoverage": {
    "lines": number,
    "branches": number,
    "functions": number
  },
  "testCases": [
    {
      "name": "string",
      "description": "string",
      "type": "unit|integration|edge_case"
    }
  ]
}`;

/**
 * Prompt for analyzing test failures
 */
export const ANALYZE_FAILURES_PROMPT = `Analyze the following test failures and suggest fixes.

Test Failures:
{{failures}}

Source Code:
{{sourceCode}}

For each failure, provide:
1. Root cause analysis
2. Suggested fix
3. Confidence level

Respond in JSON format:
{
  "analyses": [
    {
      "testName": "string",
      "rootCause": "string",
      "suggestedFix": "string",
      "codeChange": {
        "file": "string",
        "line": number,
        "oldCode": "string",
        "newCode": "string"
      },
      "confidence": 0-100
    }
  ]
}`;

/**
 * Prompt for determining if iteration should continue
 */
export const SHOULD_CONTINUE_PROMPT = `Determine if we should continue iterating on this task.

Task: {{taskTitle}}
Iteration: {{iteration}}
Max Iterations: {{maxIterations}}

Score History:
{{scoreHistory}}

Current Score: {{currentScore}}
Target Score: {{targetScore}}

Recent Issues:
{{recentIssues}}

Consider:
1. Is the score above the minimum threshold?
2. Is the score improving significantly?
3. Are there critical issues remaining?
4. Have we reached convergence?
5. Are remaining issues worth another iteration?

Respond in JSON format:
{
  "shouldContinue": boolean,
  "reason": "string",
  "recommendation": "continue|stop|rollback",
  "estimatedIterationsRemaining": number
}`;

/**
 * Prompt for generating project context
 */
export const PROJECT_CONTEXT_PROMPT = `Summarize the project context for code generation.

Architecture:
{{architecture}}

Related Files:
{{relatedFiles}}

Coding Standards:
{{codingStandards}}

Provide a concise context summary that will help generate consistent code.`;

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
 * Build previous code section for prompts
 */
export function buildPreviousCodeSection(previousCode?: string): string {
  if (!previousCode) {
    return "";
  }

  return `
Previous Implementation (needs improvement):
\`\`\`
${previousCode}
\`\`\`
`;
}

/**
 * Build feedback section for prompts
 */
export function buildFeedbackSection(
  feedback?: string,
  issues?: Array<{ severity: string; message: string }>
): string {
  if (!feedback && (!issues || issues.length === 0)) {
    return "";
  }

  let section = "\nFeedback from Previous Review:\n";

  if (feedback) {
    section += `${feedback}\n`;
  }

  if (issues && issues.length > 0) {
    section += "\nIssues to Address:\n";
    for (const issue of issues) {
      section += `- [${issue.severity}] ${issue.message}\n`;
    }
  }

  return section;
}
