/**
 * Central mock exports for testing
 */

export {
  MockAnthropic,
  setupAnthropicMock,
  createMockResponse,
  createMockStream,
  createDiscoveryMockResponses,
  createCodeGenerationMockResponses,
  createCodeReviewMockResponses,
  defaultMockResponse,
} from "./anthropic.js";

export {
  MockFileSystem,
  setupFileSystemMock,
} from "./filesystem.js";

export {
  MockCommandExecutor,
  setupExecaMock,
  type MockCommandResult,
  type MockCommandConfig,
} from "./execa.js";

/**
 * Setup all mocks for integration tests
 */
export function setupAllMocks() {
  const anthropic = setupAnthropicMock();
  const fs = setupFileSystemMock();
  const execa = setupExecaMock();

  // Setup common command mocks
  execa.registerTestRunner();
  execa.registerLinter();
  execa.registerGit();

  return {
    anthropic,
    fs,
    execa,
    reset: () => {
      anthropic.reset();
      fs.reset();
      execa.reset();
    },
  };
}
