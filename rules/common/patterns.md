# Architecture Patterns — corbat-coco

## Core Patterns

### 1. Tool Registry Pattern
All tools are registered centrally and discoverable by the LLM:

```typescript
// src/tools/my-tool.ts
import type { ToolRegistry } from "../registry.js";
import { z } from "zod";

const MyToolParamsSchema = z.object({
  input: z.string().describe("The input to process"),
});

export function registerMyTool(registry: ToolRegistry): void {
  registry.register({
    name: "myTool",
    description: "What this tool does for the LLM",
    parameters: MyToolParamsSchema,
    execute: async (params) => {
      try {
        const result = doWork(params.input);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

// src/tools/index.ts — add to registerAllTools()
registerMyTool(registry);
```

### 2. Zod Configuration Pattern
All config validated at boundaries with Zod:

```typescript
// src/config/schema.ts — extend existing schema
const MyFeatureConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeout: z.number().min(1000).max(60000).default(5000),
  mode: z.enum(["fast", "thorough"]).default("thorough"),
});

// Type from schema — no manual interface needed
type MyFeatureConfig = z.infer<typeof MyFeatureConfigSchema>;
```

### 3. Provider-Agnostic Pattern
Features must work with ALL providers:

```typescript
// Always accept LLMProvider interface, never concrete provider
async function doAgentWork(
  provider: LLMProvider,  // not AnthropicProvider
  messages: Message[],
): Promise<string> {
  const response = await provider.chat(messages, { maxTokens: 2048 });
  return response.content;
}
```

### 4. REPL Skill Pattern
Skills extend the REPL without modifying core:

```typescript
// src/cli/repl/skills/builtin/my-skill.ts
import type { Skill } from "../types.js";

export const mySkill: Skill = {
  name: "my-skill",
  description: "Short description shown in /help",
  usage: "/my-skill [args]",
  aliases: ["ms"],
  category: "general",
  execute: async (args, context) => {
    const { cwd, session, provider, config } = context;
    // Implementation
    return {
      success: true,
      output: "Result displayed to user",
    };
  },
};

// src/cli/repl/skills/index.ts — register it
import { mySkill } from "./builtin/my-skill.js";
registry.register(mySkill);
```

### 5. Phase Context Pattern
All COCO phases use a shared context:

```typescript
// Phases receive context and return typed results
async function executeMyPhase(context: PhaseContext): Promise<PhaseResult> {
  const { provider, config, projectPath } = context;
  // ... phase logic
  return {
    success: true,
    data: { /* phase output */ },
    nextPhase: "orchestrate",
  };
}
```

### 6. Error Result Pattern
Tools and async functions return structured results, never throw:

```typescript
type Result<T> = { success: true; data: T } | { success: false; error: string };

async function safeFetch(url: string): Promise<Result<string>> {
  try {
    const response = await fetch(url);
    return { success: true, data: await response.text() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

## Anti-Patterns to Avoid

- **God objects**: Classes/modules with too many responsibilities
- **Provider lock-in**: Code that only works with Anthropic
- **Sync I/O**: `fs.readFileSync` — always use `fs/promises`
- **Direct process.env**: Access through config system instead
- **Throw in tools**: Return `{ success: false, error }` instead
- **Hardcoded paths**: Use `process.cwd()` or config `projectPath`
