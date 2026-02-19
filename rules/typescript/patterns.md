# TypeScript Patterns for corbat-coco Projects

## Factory Functions over Classes

Prefer factory functions for dependency injection:

```typescript
// ✅ Factory function — easy to test, no this-binding issues
export function createQualityEvaluator(config: QualityConfig): QualityEvaluator {
  const logger = getLogger();

  async function evaluate(code: string): Promise<QualityScores> {
    logger.debug("Evaluating quality", { codeLength: code.length });
    // ...
    return scores;
  }

  return { evaluate };
}

// Interface for the return type
export interface QualityEvaluator {
  evaluate(code: string): Promise<QualityScores>;
}
```

## Discriminated Unions for Results

```typescript
type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

// Usage — TypeScript narrows correctly
const result = await executeTool(params);
if (result.success) {
  console.log(result.data); // data is typed T
} else {
  console.error(result.error); // error is string
}
```

## Branded Types for Safety

```typescript
// Prevent passing wrong IDs by accident
type AgentId = string & { readonly brand: "AgentId" };
type TaskId = string & { readonly brand: "TaskId" };

function createAgentId(id: string): AgentId {
  return id as AgentId;
}

// Now TypeScript prevents: getTask(agentId) when it expects TaskId
```

## Readonly for Immutability

```typescript
// Mark data that shouldn't be mutated
interface QualityConfig {
  readonly minScore: number;
  readonly weights: Readonly<Record<string, number>>;
  readonly thresholds: Readonly<QualityThresholds>;
}

// Readonly array
function analyzeFiles(paths: readonly string[]): Promise<QualityScores> { ... }
```

## Satisfies for Const Records

```typescript
const AGENT_CONFIGS = {
  explore: { maxTurns: 10, model: "sonnet" },
  plan: { maxTurns: 8, model: "opus" },
  test: { maxTurns: 15, model: "sonnet" },
} satisfies Record<AgentType, AgentConfig>;
// TypeScript infers literal types but also validates shape
```

## Template Literal Types

```typescript
type EventName = `agent:${AgentType}:${"start" | "complete" | "fail"}`;
// → "agent:explore:start" | "agent:explore:complete" | "agent:plan:start" | ...

type ToolName = `tool_${string}`;
```

## Async Generators for Streaming

```typescript
// LLM streaming response
async function* streamResponse(
  provider: LLMProvider,
  messages: Message[],
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of provider.stream(messages)) {
    yield chunk.content;
  }
}

// Usage
for await (const text of streamResponse(provider, messages)) {
  process.stdout.write(text);
}
```
