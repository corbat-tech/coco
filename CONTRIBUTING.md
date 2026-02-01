# Contributing to Corbat-Coco

First off, thank you for considering contributing to Corbat-Coco! It's people like you that make Corbat-Coco such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Architecture Guidelines](#architecture-guidelines)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to creating a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- **Node.js**: Version 22.0.0 or higher
- **pnpm**: Version 10.0.0 (enforced via `packageManager` field)
- **Git**: For version control
- **Anthropic API Key**: For running integration tests (optional)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/corbat/corbat-coco.git
cd corbat-coco

# Install dependencies
pnpm install

# Run the CLI in development mode
pnpm dev --help

# Run tests
pnpm test

# Run all checks (typecheck + lint + test)
pnpm check
```

## Development Setup

### Environment Variables

Create a `.env` file for local development (never commit this):

```bash
# Required for integration tests with real LLM
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Custom config path
COCO_CONFIG_PATH=/path/to/config.json
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run CLI with tsx (development mode) |
| `pnpm build` | Build with tsup |
| `pnpm build:watch` | Build in watch mode |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm lint` | Run oxlint |
| `pnpm lint:fix` | Run oxlint with auto-fix |
| `pnpm format` | Check formatting with oxfmt |
| `pnpm format:fix` | Fix formatting |
| `pnpm test` | Run tests with Vitest |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm check` | Run all checks (typecheck + lint + test) |

## Project Structure

```
corbat-coco/
├── src/
│   ├── cli/                # CLI commands (Commander.js)
│   │   ├── commands/       # Individual command implementations
│   │   └── index.ts        # CLI entry point
│   │
│   ├── config/             # Configuration system (Zod schemas)
│   │   ├── schema.ts       # Configuration schema definitions
│   │   └── loader.ts       # Config loading and validation
│   │
│   ├── orchestrator/       # Central coordinator
│   │   └── index.ts        # State machine and session management
│   │
│   ├── phases/             # COCO methodology phases
│   │   ├── converge/       # Requirements discovery
│   │   ├── orchestrate/    # Architecture planning
│   │   ├── complete/       # Code generation & iteration
│   │   └── output/         # Deployment preparation
│   │
│   ├── providers/          # LLM provider integrations
│   │   ├── anthropic.ts    # Anthropic Claude implementation
│   │   └── types.ts        # Provider interfaces
│   │
│   ├── quality/            # Quality scoring system
│   │   └── types.ts        # Quality dimensions & thresholds
│   │
│   ├── tools/              # Tool implementations
│   │   ├── file.ts         # File operations
│   │   ├── bash.ts         # Command execution
│   │   ├── git.ts          # Git operations
│   │   ├── test.ts         # Test running
│   │   ├── quality.ts      # Quality analysis
│   │   └── registry.ts     # Tool registry
│   │
│   ├── types/              # Shared type definitions
│   │   └── task.ts         # Task, Story, Epic, Sprint types
│   │
│   └── utils/              # Utility functions
│       ├── errors.ts       # Custom error classes
│       ├── logger.ts       # Logging (tslog)
│       └── validation.ts   # Input validation helpers
│
├── test/
│   ├── e2e/                # End-to-end tests
│   ├── mocks/              # Mock implementations
│   └── fixtures/           # Test fixtures
│
├── docs/
│   ├── architecture/       # Architecture documentation
│   │   ├── ARCHITECTURE.md # C4 diagrams
│   │   └── adrs/           # Architecture Decision Records
│   └── guides/             # User guides
│
└── examples/               # Example projects
```

## Making Changes

### Branch Naming

Use descriptive branch names:

```
feat/add-openai-provider
fix/checkpoint-recovery-issue
docs/improve-readme
refactor/simplify-quality-scorer
test/add-converge-phase-tests
```

### Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```

2. **Make your changes** following the code style guidelines

3. **Write tests** for your changes (minimum 80% coverage)

4. **Run checks**:
   ```bash
   pnpm check
   ```

5. **Commit** with a conventional commit message

6. **Push** and open a Pull Request

## Testing

### Test Structure

Tests should be colocated with source files:

```
src/
├── utils/
│   ├── errors.ts
│   └── errors.test.ts      # ← Test file next to source
├── phases/
│   └── converge/
│       ├── discovery.ts
│       └── discovery.test.ts
```

### Writing Tests

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { YourModule } from "./your-module.js";

describe("YourModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("methodName", () => {
    it("should do something specific", () => {
      // Arrange
      const input = "test";

      // Act
      const result = YourModule.methodName(input);

      // Assert
      expect(result).toBe("expected");
    });

    it("should handle edge cases", () => {
      expect(() => YourModule.methodName(null)).toThrow();
    });
  });
});
```

### Mocking the Anthropic API

```typescript
import { vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Mocked response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    };
  },
}));
```

### Coverage Requirements

- **Lines**: 80% minimum
- **Functions**: 80% minimum
- **Branches**: 80% minimum
- **Statements**: 80% minimum

Run coverage report:
```bash
pnpm test:coverage
```

## Code Style

### TypeScript Guidelines

- **Strict mode**: Always enabled
- **ESM only**: No CommonJS (`require`, `module.exports`)
- **Imports**: Use `.js` extension in imports
- **Types**: Prefer explicit types, avoid `any`
- **Async**: Always use `async/await` (no raw Promises)

```typescript
// ✅ Good
import { something } from "./module.js";

export async function doSomething(input: string): Promise<Result> {
  const data = await fetchData(input);
  return processData(data);
}

// ❌ Bad
const { something } = require("./module");

export function doSomething(input) {
  return fetchData(input).then((data) => processData(data));
}
```

### File Organization

- Keep files under 500 lines when possible
- One export per file for main modules
- Group related utilities together
- Document public APIs with JSDoc

```typescript
/**
 * Calculates the quality score for a set of files.
 *
 * @param files - Array of file paths to analyze
 * @param options - Scoring options
 * @returns Quality scores with individual dimensions
 *
 * @example
 * ```typescript
 * const scores = await calculateQuality(["src/index.ts"], {
 *   includeTests: true,
 * });
 * console.log(scores.overall); // 85
 * ```
 */
export async function calculateQuality(
  files: string[],
  options?: QualityOptions
): Promise<QualityScores> {
  // Implementation
}
```

### Linting & Formatting

We use `oxlint` for linting and `oxfmt` for formatting:

```bash
# Check
pnpm lint
pnpm format

# Fix
pnpm lint:fix
pnpm format:fix
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build process or auxiliary tool changes |

### Scopes

| Scope | Description |
|-------|-------------|
| `cli` | CLI commands |
| `converge` | CONVERGE phase |
| `orchestrate` | ORCHESTRATE phase |
| `complete` | COMPLETE phase |
| `output` | OUTPUT phase |
| `quality` | Quality system |
| `tools` | Tool implementations |
| `provider` | LLM providers |
| `config` | Configuration |

### Examples

```bash
feat(cli): add --verbose flag to build command

fix(complete): handle empty test results gracefully

docs(readme): add troubleshooting section

test(converge): add discovery engine tests

refactor(quality): simplify score calculation
```

## Pull Request Process

1. **Ensure all checks pass**:
   ```bash
   pnpm check
   ```

2. **Update documentation** if needed

3. **Add tests** for new functionality

4. **Fill out the PR template** completely

5. **Request review** from maintainers

6. **Address feedback** promptly

### PR Checklist

- [ ] Code follows the style guidelines
- [ ] Self-reviewed the code
- [ ] Added tests (80%+ coverage)
- [ ] Updated documentation
- [ ] All checks pass (`pnpm check`)
- [ ] No new warnings

## Architecture Guidelines

### COCO Phases

When contributing to a specific phase, understand its responsibilities:

| Phase | Responsibility | Key Files |
|-------|---------------|-----------|
| **CONVERGE** | Requirements discovery | `src/phases/converge/` |
| **ORCHESTRATE** | Architecture planning | `src/phases/orchestrate/` |
| **COMPLETE** | Code generation & iteration | `src/phases/complete/` |
| **OUTPUT** | Deployment preparation | `src/phases/output/` |

### Adding New Tools

1. Create tool in `src/tools/`:
   ```typescript
   export const myNewTool: ToolDefinition<MyInput, MyOutput> = {
     name: "myNewTool",
     description: "Does something useful",
     category: "utility",
     parameters: MyInputSchema,
     execute: async (params) => {
       // Implementation
     },
   };
   ```

2. Register in `src/tools/registry.ts`

3. Add tests in `src/tools/my-new-tool.test.ts`

### Adding New Providers

1. Implement the `LLMProvider` interface in `src/providers/`
2. Add configuration schema in `src/config/schema.ts`
3. Register in provider factory
4. Add tests with mocked API calls

## Questions?

If you have questions, feel free to:

- Open a [Discussion](https://github.com/corbat/corbat-coco/discussions)
- Check existing [Issues](https://github.com/corbat/corbat-coco/issues)

Thank you for contributing! 🎉
