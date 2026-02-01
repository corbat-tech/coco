# ADR-001: TypeScript with ESM Modules

## Status

Accepted

## Date

2024-01-15

## Context

We need to choose the programming language and module system for Corbat-Coco. The agent will:

1. Parse and generate code for multiple languages
2. Integrate with modern Node.js tooling
3. Require strong typing for reliability
4. Need excellent IDE support for development

The choice of module system affects compatibility with dependencies and future maintainability.

## Decision

We will use **TypeScript 5.4+** with **ECMAScript Modules (ESM)** as the primary module system.

Configuration:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true
  }
}
```

## Rationale

### TypeScript

1. **Type Safety**: Catches errors at compile time, critical for an agent manipulating code
2. **IDE Support**: Excellent autocomplete, refactoring, and navigation
3. **Self-Documentation**: Types serve as documentation for complex interfaces
4. **Ecosystem**: Native support for most Node.js libraries
5. **Reference Implementation**: OpenClaw uses TypeScript, providing proven patterns

### ESM over CommonJS

1. **Future-Proof**: ESM is the JavaScript standard, CJS is legacy
2. **Tree Shaking**: Better bundle optimization
3. **Top-Level Await**: Simplifies async initialization
4. **Native Node.js**: Node 22+ has excellent ESM support
5. **Consistency**: Matches browser JavaScript

## Alternatives Considered

### Alternative 1: JavaScript with JSDoc

**Description:** Plain JavaScript with type annotations in JSDoc comments.

**Pros:**
- No compilation step
- Simpler tooling
- Native Node.js

**Cons:**
- Weaker type inference
- Verbose type annotations
- Less refactoring support

**Why rejected:** The complexity of the agent requires strong typing for maintainability.

### Alternative 2: TypeScript with CommonJS

**Description:** TypeScript compiled to CommonJS modules.

**Pros:**
- Better compatibility with older packages
- More familiar to some developers

**Cons:**
- Legacy module system
- No top-level await
- Worse tree shaking

**Why rejected:** ESM is the future; better to start there.

### Alternative 3: Rust or Go

**Description:** Use a systems language for performance.

**Pros:**
- Better performance
- Single binary distribution
- No runtime dependencies

**Cons:**
- Slower development velocity
- Smaller ecosystem for AI/LLM integration
- Harder to prototype

**Why rejected:** Development speed is more important than raw performance for this use case. LLM calls dominate execution time anyway.

## Consequences

### Positive

- Strong type checking catches bugs early
- Excellent developer experience with IDE support
- Future-compatible module system
- Easy integration with npm ecosystem

### Negative

- Build step required (tsc or tsup)
- Some packages may need ESM wrappers
- Slightly more complex package.json configuration

### Neutral

- Learning curve for developers unfamiliar with TypeScript
- Need to keep TypeScript version updated

## Implementation Notes

1. Use `"type": "module"` in package.json
2. Use `.js` extensions in imports (TypeScript resolves these)
3. Use `tsx` for development execution
4. Use `tsup` for production builds

## Related Decisions

- ADR-002: Build System (tsup vs esbuild)
- ADR-003: Testing Framework (vitest)

## References

- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [TypeScript ESM Support](https://www.typescriptlang.org/docs/handbook/esm-node.html)
- OpenClaw's TypeScript configuration
