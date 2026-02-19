# Coding Style — Common Rules

These rules apply to ALL code in corbat-coco regardless of file type.

## Naming Conventions

- **Variables/functions**: `camelCase`
- **Types/interfaces/classes**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE` for module-level constants
- **Files**: `kebab-case.ts` (e.g., `quality-evaluator.ts`)
- **Test files**: `kebab-case.test.ts` colocated next to source
- **Directories**: `kebab-case/`

## Function Design

- Functions must do ONE thing (Single Responsibility)
- Maximum 50 lines per function — extract helpers beyond that
- Maximum 4 levels of nesting — use early returns to flatten
- Prefer pure functions when possible (no side effects)
- Name functions as verbs: `calculateScore()`, `parseConfig()`, `registerTool()`

## File Size

- Maximum 500 LOC per file
- If a file grows beyond that, split by responsibility
- Index files (`index.ts`) should only re-export, not contain logic

## Comments

- Comments explain WHY, not WHAT
- Avoid obvious comments: `// increment counter` above `count++`
- Use JSDoc for all exported functions, classes, and types
- Inline comments for non-obvious algorithms or business rules

## Error Handling

- Always handle errors explicitly — no swallowed exceptions
- Use `error instanceof Error ? error.message : String(error)` pattern
- Return `{ success: false, error: string }` from tool functions
- Never throw from tool implementations — catch and return error result
- Log errors with context using `getLogger().error(msg, { error })`

## No Magic Numbers

```typescript
// ❌ Magic number
if (score > 85) { ... }

// ✅ Named constant
const MIN_QUALITY_SCORE = 85;
if (score > MIN_QUALITY_SCORE) { ... }
```

## No console.log

```typescript
// ❌ Never in production code
console.log("debug:", data);

// ✅ Always use logger
import { getLogger } from "../../utils/logger.js";
const logger = getLogger();
logger.debug("Processing", { data });
```

## Async/Await

- Always use `async/await` — no raw `.then()/.catch()` chains
- Always `await` Promises — no floating promises (or use `void` with comment)
- Use `Promise.all()` for independent parallel operations:
  ```typescript
  const [a, b] = await Promise.all([fetchA(), fetchB()]);
  ```
