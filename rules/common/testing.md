# Testing Rules — Common

## Framework

- **Vitest** for all tests (`pnpm test`)
- Coverage via `@vitest/coverage-v8` (`pnpm test:coverage`)
- E2E tests in `test/e2e/` with separate config (`vitest.e2e.config.ts`)

## Coverage Thresholds

| Metric | Minimum |
|--------|---------|
| Lines | 80% |
| Functions | 80% |
| Branches | 80% |
| Statements | 80% |
| Security-critical code | 100% |
| Config validation | 100% |

## File Organization

- Colocate unit tests next to source: `src/path/foo.test.ts` alongside `src/path/foo.ts`
- Integration/E2E tests: `test/e2e/`
- Test utilities and mocks: `test/mocks/`
- Run specific: `pnpm test src/path/to/`

## Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ModuleName", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Reset between tests
  });

  describe("functionName", () => {
    it("returns expected result for valid input", async () => { ... });
    it("handles empty input gracefully", async () => { ... });
    it("throws/returns error for invalid input", async () => { ... });
  });
});
```

## What to Test

Every feature must cover:
- ✅ Happy path (valid inputs, expected output)
- ✅ Empty/null/undefined inputs
- ✅ Error conditions (network failure, invalid data)
- ✅ Boundary values
- ✅ Concurrent access (where applicable)

## What NOT to Test

- ❌ Implementation details (private methods, internal state)
- ❌ Third-party library behavior (mock it instead)
- ❌ Trivial getters/setters

## Mocking

```typescript
// Mock module
vi.mock("../../providers/index.js", () => ({
  createProvider: vi.fn().mockResolvedValue(mockProvider),
}));

// Mock fs
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));
```

## Assertion Quality

```typescript
// ❌ Weak assertions
expect(result).toBeDefined();
expect(result).toBeTruthy();

// ✅ Specific assertions
expect(result.success).toBe(true);
expect(result.data).toEqual({ score: 92 });
expect(result.error).toMatch(/invalid input/i);
```
