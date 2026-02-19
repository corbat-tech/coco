# Performance Rules

## Async Parallelism

Maximize parallelism for independent operations:

```typescript
// ❌ Sequential — unnecessarily slow
const a = await fetchA();
const b = await fetchB();
const c = await fetchC();

// ✅ Parallel — 3x faster
const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]);
```

## File I/O

```typescript
// ❌ Reading entire large files into memory
const content = await fs.readFile(hugePath, "utf-8"); // 100MB in memory

// ✅ Stream large files
import { createReadStream } from "node:fs";
const stream = createReadStream(hugePath);
```

## Agent Loop Efficiency

In agent execution loops, minimize redundant LLM calls:
- Cache tool results where safe (file content, git status)
- Batch related tool calls in a single LLM turn
- Use `maxTokens` appropriate to the task (don't request 4096 for a simple query)

## Quality Score Caching

Quality evaluations are expensive — cache within the same session:
```typescript
// Quality scores are valid for the duration of a quality iteration
// Don't re-evaluate unchanged files
```

## MCP Connection Management

- Reuse MCP connections across tool calls (don't reconnect per-call)
- Close connections on session end via lifecycle hooks

## Token Budget Awareness

LLM API calls are the main cost driver:
- Keep system prompts concise and reusable
- Use prompt caching for repeated system prompts (Anthropic provider)
- Monitor and log token usage per operation
- Prefer small targeted agent calls over one massive context window
