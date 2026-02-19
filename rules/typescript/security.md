# TypeScript Security Rules

## No Dynamic Imports of User Data

```typescript
// ❌ Never dynamically import user-provided paths
const module = await import(userPath);

// ✅ Import from allowlisted locations only
const modules = { "plugin-a": () => import("./plugins/a.js") };
const loader = modules[validatedPluginName];
if (!loader) throw new Error("Unknown plugin");
const module = await loader();
```

## Type-Safe Environment Variables

```typescript
// ❌ Unsafe — process.env returns string | undefined
const key = process.env.ANTHROPIC_API_KEY;
doSomething(key); // Could be undefined

// ✅ Validate at startup with Zod
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  COCO_PROVIDER: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
});
const env = EnvSchema.parse(process.env);
```

## Safe JSON Parsing

```typescript
// ❌ Throws on invalid JSON
const data = JSON.parse(rawString);

// ✅ Always wrap in try/catch or use safe wrapper
import { jsonrepair } from "jsonrepair";

function safeJsonParse<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    const repaired = jsonrepair(raw); // handle LLM JSON quirks
    const parsed = JSON.parse(repaired);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
```

## Prototype Pollution Prevention

```typescript
// ❌ Unsafe object spread from user data
const config = { ...defaultConfig, ...userInput };

// ✅ Use Zod to strip unknown keys
const config = ConfigSchema.parse(userInput); // strips extra keys
```

## Regex Safety (ReDoS)

```typescript
// ❌ Catastrophic backtracking risk
const vulnerable = /^(a+)+$/;

// ✅ Linear regex patterns
// - Avoid nested quantifiers
// - Use anchors appropriately
// - Test with adversarial inputs
```

## TypeScript Assertion Safety

```typescript
// ❌ Unsafe assertion — could crash at runtime
const value = (data as { key: string }).key;

// ✅ Type guard first
function hasKey(obj: unknown): obj is { key: string } {
  return typeof obj === "object" && obj !== null && "key" in obj &&
    typeof (obj as Record<string, unknown>).key === "string";
}
if (hasKey(data)) { ... }
```

## Dependency Auditing

```bash
# Regular audit (add to pre-release checklist)
pnpm audit

# Check specific package
pnpm audit --filter package-name

# Update to fix vulnerabilities
pnpm update --latest  # review changelog first
```
