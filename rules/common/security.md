# Security Rules — Common

## Non-Negotiable: Never Commit Secrets

```gitignore
# These must be in .gitignore (already are):
.env
.coco/
.claude/settings.local.json
```

Verify before committing:
```bash
git diff --staged | grep -i "sk-ant\|api_key\|password\|secret\|token"
```

## API Keys

- Store in `~/.coco/.env` (global) or `.env` (project-level, gitignored)
- Access via `config.provider.apiKey` — never `process.env.ANTHROPIC_API_KEY` directly in tools
- Never log API keys, even partially
- Rotate immediately if accidentally committed

## Shell Command Safety

```typescript
// ✅ Always use array arguments with execa
await execa("git", ["commit", "-m", userMessage]);
await execa("grep", ["-r", pattern, directory]);

// ❌ Never interpolate user/LLM content into shell strings
await execa(`git commit -m "${userMessage}"`);  // injection risk
```

## Path Traversal Prevention

```typescript
import path from "node:path";

function safePath(projectRoot: string, userPath: string): string {
  const resolved = path.resolve(projectRoot, userPath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  return resolved;
}
```

## Input Validation

Always validate at system boundaries using Zod:
```typescript
const ToolInputSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(100_000),
});

const parsed = ToolInputSchema.safeParse(rawInput);
if (!parsed.success) {
  return { success: false, error: `Invalid input: ${parsed.error.message}` };
}
```

## LLM Output Safety

Never blindly execute LLM-generated content:
```typescript
// ✅ Always validate tool call arguments through Zod before execution
const parsed = ToolParamsSchema.safeParse(toolCall.input);
if (!parsed.success) {
  return { type: "tool_result", is_error: true, content: "Invalid arguments" };
}
// Then execute with validated params
const result = await registry.execute(toolCall.name, parsed.data);
```

## Dependency Security

```bash
# Check weekly
pnpm audit

# Fix automatically where possible
pnpm audit --fix
```

Critical/high vulnerabilities must be resolved before any release.

## Error Messages

```typescript
// ✅ Generic error to user
return { success: false, error: "Authentication failed" };

// ❌ Don't expose internals
return { success: false, error: `PostgreSQL error: relation "users" does not exist at ${internalPath}` };
```
