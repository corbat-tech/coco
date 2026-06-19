# Coco Public API v0

This document defines the first stable embedding surface for products built on
Coco Runtime. APIs not listed here should be treated as internal or
experimental.

## Imports

```ts
import { createAgentRuntime } from "@corbat-tech/coco/runtime";
import { createSupportRagToolRegistry } from "@corbat-tech/coco/tools";
import { supportRagAssistantPreset } from "@corbat-tech/coco/presets";
import { createHttpAssistantAdapter } from "@corbat-tech/coco/adapters";
```

The root package `@corbat-tech/coco` continues to re-export these APIs for
backwards compatibility, but new embedded products should prefer subpath
imports.

## Stable Runtime Contracts

- `AgentRuntime`: provider, sessions, turns, tool execution, policy, and events.
- `RuntimeTurnRunner`: pluggable turn execution strategy.
- `DefaultRuntimeTurnRunner`: text-only chat turns.
- `ToolCallingRuntimeTurnRunner`: provider tool-use loop routed through runtime
  permissions and event logging.
- `RuntimeSessionStore`: synchronous active-process session store interface.
- `EventLog`: runtime event sink.
- `PermissionPolicy`: tool and input policy decisions.
- `KnowledgeRetriever`: search interface for RAG products.
- `AgentBlueprint` and `AgentPreset`: product-safe agent configuration.

## Product-Safe Defaults

`Coco Code` may use the full coding tool registry in trusted developer
contexts. Public, web, support, and internal business agents must use explicit
tool registries and narrow policies.

Support/RAG products should start with:

- `knowledge_search`
- `create_support_draft`
- `request_human_escalation`

`request_human_escalation` is confirmation-gated and must not run unless the
embedding application passes explicit confirmation.

## Persistence

Local products can use in-memory or file stores. Hosted products can use the
Postgres adapters with any client that implements:

```ts
interface PostgresQueryClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
```

Apply `src/runtime/migrations/001_runtime_postgres.sql` before using the
Postgres adapters.

## Transitional Monorepo Boundary

`packages/runtime`, `packages/tools`, and `packages/presets` are internal
workspace wrappers during the transition. They are not public packages yet.
The public package remains `@corbat-tech/coco`.
