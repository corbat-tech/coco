# Corbat-Coco Development Guidelines

## Project Overview
- **Name**: Corbat-Coco
- **Purpose**: Autonomous coding agent with self-review and quality convergence
- **Language**: TypeScript (ESM)
- **Runtime**: Node.js 22+

## Repository Structure
```
corbat-coco/
├── src/
│   ├── cli/              # CLI commands
│   ├── orchestrator/     # Central coordinator
│   ├── phases/           # COCO phases (converge, orchestrate, complete, output)
│   ├── quality/          # Quality scoring system
│   ├── persistence/      # Checkpoints and recovery
│   ├── providers/        # LLM providers
│   ├── tools/            # Tool implementations
│   ├── config/           # Configuration system
│   └── types/            # Type definitions
├── test/                 # Tests
├── docs/                 # Documentation
└── examples/             # Example projects
```

## Build & Development
- **Install**: `pnpm install`
- **Dev**: `pnpm dev` (runs with tsx)
- **Build**: `pnpm build` (tsup)
- **Test**: `pnpm test` (vitest)
- **Lint**: `pnpm lint` (oxlint)
- **Format**: `pnpm format` (oxfmt)
- **Typecheck**: `pnpm typecheck`
- **Full check**: `pnpm check` (typecheck + lint + test)

## Coding Style
- **Language**: TypeScript with strict mode
- **Modules**: ESM only (no CommonJS)
- **Imports**: Use `.js` extension in imports
- **Types**: Prefer explicit types, avoid `any`
- **Formatting**: oxfmt (similar to prettier)
- **Linting**: oxlint (fast, minimal config)

## Key Patterns

### Configuration (Zod schemas)
```typescript
import { z } from "zod";
const Schema = z.object({ ... });
type Config = z.infer<typeof Schema>;
```

### CLI Commands (Commander)
```typescript
import { Command } from "commander";
export function registerCommand(program: Command): void { ... }
```

### Prompts (Clack)
```typescript
import * as p from "@clack/prompts";
const result = await p.text({ message: "..." });
if (p.isCancel(result)) process.exit(0);
```

### Async File Operations
```typescript
const fs = await import("node:fs/promises");
await fs.readFile(path, "utf-8");
```

## Quality Thresholds
- **Min Score**: 85/100 (senior-level)
- **Test Coverage**: 80%+
- **Security**: No vulnerabilities (100)
- **Max Iterations**: 10 per task
- **Convergence**: Delta < 2 between iterations

## COCO Phases
1. **Converge**: Gather requirements, create specification
2. **Orchestrate**: Design architecture, create backlog
3. **Complete**: Execute tasks with quality iteration
4. **Output**: Generate CI/CD, docs, deployment

## Important Files
- `AGENT_PROMPT.md` - Current development priorities and agent prompt
- `docs/MASTER_PLAN.md` - Complete development plan (reference)
- `docs/architecture/ARCHITECTURE.md` - System architecture
- `docs/architecture/adrs/` - Architecture Decision Records
- `src/quality/types.ts` - Quality scoring types
- `src/types/task.ts` - Task and backlog types

## Testing
- Framework: Vitest
- Coverage threshold: 80%
- Colocate tests: `*.test.ts` next to source
- Run specific test: `pnpm test src/config/`

## Commits
- Use conventional commits
- Format: `type(scope): message`
- Types: feat, fix, docs, refactor, test, chore

## Development Notes
- Never use CommonJS (`require`, `module.exports`)
- Always use async/await (no raw promises)
- Prefer functional patterns over classes
- Keep files under 500 LOC when possible
- Document public APIs with JSDoc comments
