# TypeScript Coding Style

## TypeScript Configuration

corbat-coco uses strict TypeScript (`tsconfig.json`):
```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUncheckedIndexedAccess": true,
  "moduleResolution": "NodeNext",
  "module": "NodeNext",
  "target": "ES2022"
}
```

These are **enforced by the compiler** — treat compiler errors as bugs.

## ESM-Only

```typescript
// ✅ ESM imports — always with .js extension
import { foo } from "./foo.js";
import type { Bar } from "./types.js";
import { z } from "zod";

// ❌ Never CommonJS
const foo = require("./foo");
module.exports = { foo };

// ❌ Never __dirname or __filename
const dir = __dirname;

// ✅ ESM equivalent
import { fileURLToPath } from "node:url";
import path from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

## Types — Be Explicit

```typescript
// ❌ Avoid any
function process(data: any): any { ... }

// ✅ Use explicit types
function process(data: ProcessInput): ProcessOutput { ... }

// ✅ Use unknown for truly unknown data, then narrow
function parse(raw: unknown): ProcessInput {
  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid input");
  return parsed.data;
}

// ✅ Use type assertions only when provably safe
const element = document.getElementById("app") as HTMLDivElement;
```

## Interfaces vs Types

```typescript
// Use interface for object shapes (extensible)
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Use type for unions, intersections, computed types
type AgentType = "explore" | "plan" | "test" | "debug" | "review";
type AsyncResult<T> = Promise<{ success: true; data: T } | { success: false; error: string }>;
```

## Enums — Prefer Const

```typescript
// ✅ Const assertion (tree-shakeable, no runtime cost)
const AgentStatus = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

// ❌ Avoid TypeScript enums (runtime object, not ideal for ESM)
enum AgentStatus { IDLE = "idle", RUNNING = "running" }
```

## Null Handling (`noUncheckedIndexedAccess`)

```typescript
const items: string[] = ["a", "b", "c"];

// ❌ TypeScript error — items[0] is string | undefined
const first = items[0].toUpperCase();

// ✅ Options:
const first = items[0]?.toUpperCase() ?? "";
// or
const first = items[0];
if (first !== undefined) { ... }
// or
const [first = ""] = items;
```

## Zod Patterns

```typescript
// Schema → Type (single source of truth)
const ConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
  model: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().min(1).max(32768).default(8192),
});
type Config = z.infer<typeof ConfigSchema>;

// Validation at boundaries
const parsed = ConfigSchema.safeParse(rawConfig);
if (!parsed.success) {
  throw new Error(`Config error: ${parsed.error.message}`);
}
```

## Import Organization

```typescript
// 1. Node built-ins (node: prefix)
import path from "node:path";
import { EventEmitter } from "node:events";

// 2. External packages
import { z } from "zod";
import chalk from "chalk";

// 3. Internal absolute (src/)
import { getLogger } from "../../utils/logger.js";
import type { LLMProvider } from "../../providers/types.js";

// 4. Relative imports last
import { myHelper } from "./helper.js";
```
