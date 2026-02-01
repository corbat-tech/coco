/**
 * Mock implementation of Anthropic SDK for testing
 */

import { vi } from "vitest";

/**
 * Default mock response for chat completions
 */
export const defaultMockResponse = {
  id: "msg_mock_123",
  type: "message" as const,
  role: "assistant" as const,
  content: [
    {
      type: "text" as const,
      text: "This is a mocked response from Claude.",
    },
  ],
  model: "claude-sonnet-4-20250514",
  stop_reason: "end_turn" as const,
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
  },
};

/**
 * Create a mock response with custom text
 */
export function createMockResponse(text: string, options?: {
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
}) {
  const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [
    { type: "text", text },
  ];

  if (options?.toolUse) {
    content.push({
      type: "tool_use",
      id: options.toolUse.id,
      name: options.toolUse.name,
      input: options.toolUse.input,
    });
  }

  return {
    ...defaultMockResponse,
    content,
  };
}

/**
 * Create a mock streaming response
 */
export function createMockStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield {
          type: "content_block_delta" as const,
          delta: {
            type: "text_delta" as const,
            text: chunk,
          },
        };
      }
      yield {
        type: "message_stop" as const,
      };
    },
  };
}

/**
 * Mock Anthropic class
 */
export class MockAnthropic {
  apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  messages = {
    create: vi.fn().mockResolvedValue(defaultMockResponse),
    stream: vi.fn().mockReturnValue(createMockStream(["Hello", " ", "world", "!"])),
  };

  /**
   * Set custom response for next create call
   */
  setNextResponse(response: typeof defaultMockResponse) {
    this.messages.create.mockResolvedValueOnce(response);
  }

  /**
   * Set error for next create call
   */
  setNextError(error: Error) {
    this.messages.create.mockRejectedValueOnce(error);
  }

  /**
   * Reset all mocks
   */
  reset() {
    this.messages.create.mockReset();
    this.messages.create.mockResolvedValue(defaultMockResponse);
    this.messages.stream.mockReset();
    this.messages.stream.mockReturnValue(createMockStream(["Hello", " ", "world", "!"]));
  }
}

/**
 * Setup mock for @anthropic-ai/sdk
 */
export function setupAnthropicMock() {
  const mockInstance = new MockAnthropic({ apiKey: "test-key" });

  vi.mock("@anthropic-ai/sdk", () => ({
    default: class {
      constructor() {
        return mockInstance;
      }
    },
  }));

  return mockInstance;
}

/**
 * Create mock for discovery phase responses
 */
export function createDiscoveryMockResponses() {
  return [
    // Initial questions
    createMockResponse(JSON.stringify({
      questions: [
        "What is the main purpose of this project?",
        "What programming language do you prefer?",
        "Any specific framework requirements?",
      ],
    })),
    // Clarification questions
    createMockResponse(JSON.stringify({
      questions: [
        "Do you need authentication?",
        "What database do you want to use?",
      ],
    })),
    // Specification generation
    createMockResponse(JSON.stringify({
      specification: {
        name: "test-project",
        description: "A test project",
        requirements: {
          functional: ["User authentication", "CRUD operations"],
          nonFunctional: ["Performance", "Security"],
        },
      },
    })),
  ];
}

/**
 * Create mock for code generation responses
 */
export function createCodeGenerationMockResponses() {
  return [
    createMockResponse(JSON.stringify({
      files: [
        {
          path: "src/index.ts",
          content: 'export function main() { console.log("Hello"); }',
        },
        {
          path: "src/index.test.ts",
          content: 'import { main } from "./index"; test("main", () => { main(); });',
        },
      ],
      explanation: "Generated main entry point with test",
      confidence: 85,
    })),
  ];
}

/**
 * Create mock for code review responses
 */
export function createCodeReviewMockResponses() {
  return [
    createMockResponse(JSON.stringify({
      scores: {
        overall: 87,
        dimensions: {
          correctness: 90,
          completeness: 85,
          robustness: 80,
          readability: 90,
          maintainability: 85,
          complexity: 88,
          duplication: 95,
          testCoverage: 82,
          testQuality: 80,
          security: 100,
          documentation: 75,
          style: 95,
        },
      },
      issues: [
        {
          dimension: "documentation",
          severity: "minor",
          message: "Missing JSDoc comments",
          suggestion: "Add JSDoc to public functions",
        },
      ],
      suggestions: [
        {
          dimension: "documentation",
          priority: "low",
          description: "Add JSDoc comments to all public functions",
          estimatedImpact: 5,
        },
      ],
    })),
  ];
}
