# Coco Platform Layers

Coco is evolving from a CLI-first coding agent into a reusable agent platform.
The CLI remains the main developer product, but it is one application built on
top of the same runtime that can power other assistants.

## Layers

```txt
Client channels
  -> adapters
  -> presets / blueprints
  -> Coco Runtime
  -> providers, tools, guardrails, sessions, events
```

## Monorepo Product Boundary

Coco now uses an incremental monorepo boundary:

```txt
packages/runtime   -> reusable agent runtime contracts and runners
packages/tools     -> generic tools and safe product tool profiles
packages/presets   -> reusable agent blueprints and product presets
apps/coco-code     -> trusted developer coding-agent product
apps/support-rag-assistant -> first B2B Support/RAG product app
```

The source still lives primarily in `src/` during the transition so the existing
`@corbat-tech/coco` package and CLI keep working. The package-level boundaries
make the intended architecture explicit while avoiding a risky big-bang file
move.

## Runtime

The runtime owns provider selection, sessions, streaming turns, tool execution,
permission decisions, workflows, and event logging.

Runtime exposes two turn runners:

- `DefaultRuntimeTurnRunner` for simple text-only chat turns.
- `ToolCallingRuntimeTurnRunner` for reusable agentic turns where provider tool
  calls are executed through runtime permissions, sessions, and event logs.

## Blueprints

Blueprints describe reusable agents: surface, maturity, instructions, allowed
tools, guardrails, memory, approval, and observability policy.

## Presets

Presets turn common market needs into reusable starting points:

- public website assistants;
- RAG knowledge assistants;
- sales intake;
- customer support;
- appointment booking;
- internal operations;
- Coco coding agent.

## Adapters

Adapters normalize channels such as HTTP, streaming HTTP, and webhook-style
integrations. They should not contain prompts or business logic.

## Package Strategy

Phase 1 keeps compatibility through `@corbat-tech/coco` and adds subpath exports:

- `@corbat-tech/coco/runtime`
- `@corbat-tech/coco/tools`
- `@corbat-tech/coco/presets`
- `@corbat-tech/coco/adapters`

The internal workspace wrappers prepare a future package split:

- `@corbat-tech/coco-runtime`
- `@corbat-tech/coco-presets`
- `@corbat-tech/coco-adapters`
- `@corbat-tech/coco-tools`
- `@corbat-tech/coco` as the CLI package
