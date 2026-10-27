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

## Agent Reliability

- Compact managed conversations at complete tool call/result boundaries inside long turns. Count the effective prompt after compaction; cancellation must restore the pre-turn history without orphaned tool results.
- Treat truncated provider responses as incomplete; never execute their pending tool calls or report delegated success. Failed prerequisites block dependent tasks while independent branches may continue.
- Update retry streaks and iteration extensions from the current tool batch only. Historical failures must not stop a recovered task, and historical successes must not extend a stalled one.
- Keep model effort serialization in provider adapters, derived from the shared catalog contracts. Test the wire request for both streaming and non-streaming paths.
- Background summaries must use a reasoning mode accepted by their provider/model. Prefer adapter defaults when the effective model is unknown; do not force `off` for mandatory-reasoning models.
- Use focused regression checks while editing, then run the repository's final checks. Replay fixtures verify control flow; live model evaluations must record model, effort, budgets and external acceptance results separately from heuristic quality scores.
- Headless execution does not itself grant tool authority. Isolated evaluation hosts must explicitly configure the permitted tools and exact shell invocation; preserve the normal permission boundary.
- Persist user intent and tool start/result boundaries before advancing a durable turn. An effect without a saved result is uncertain: require host inspection and resolution before resuming, and never silently replay it. Read the latest metadata when patching journals so work evidence survives.
- Keep work claims separate from observed checks. Plan tools use host-bound session identity; only current successful check receipts support `verified`, and potential mutations invalidate older checks. Receipts do not prove semantic coverage of requirements.
- Reuse runtime context budgeting and compaction from adapters. Include composed system instructions, actual offered schemas and output reserve; preserve tool pairs and host-summary provenance. Context retries must reduce the request, fit the budget and never repeat completed tools.
- Save coherent REPL snapshots at explicit iteration/command/exit boundaries. Keep action observations durable even when cancelling rolls conversation history back. Snapshot replacement is not a transaction across external effects or a multi-process lock.
- Freeze common evaluation criteria before implementation and retain scored failures without silent retries. Report capabilities, deterministic contracts and live task scores separately, including harness mistakes and request-level model/effort evidence. Do not infer general product parity, hard token limits or invoice cost from subscription metadata.

See [conversation continuity](docs/guides/CONVERSATION_CONTINUITY.md) and
[ADR 011](docs/architecture/adrs/011-durable-conversations-and-work-evidence.md)
for the public recovery contract and its limits.

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
