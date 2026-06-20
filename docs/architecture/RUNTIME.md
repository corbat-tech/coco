# Coco Reusable Runtime

Coco remains a CLI-first coding agent, but the core runtime is now available as
a reusable layer for other products and future client-specific agents.

## Runtime Responsibilities

- `AgentRuntime` wires together provider selection, tool registry, session store,
  permission policy, and event logging.
- `ProviderRegistry` exposes the verified provider/model catalog and runtime
  capability matrix.
- `ToolRegistry` remains the shared tool surface used by the CLI, headless mode,
  subagents, and future applications.
- `PermissionPolicy` exposes mode-aware tool decisions so future runtime
  consumers can match the REPL's read-only and destructive-action rules.
- `EventLog` records runtime/provider/tool decisions for replay, debugging, and
  future observability.
- `RuntimeSessionStore` stores model-facing session state outside the CLI REPL.
- `RuntimeTurnRunner` runs a single model turn against a provider. The default
  runner is intentionally conservative: it calls chat only and does not execute
  tools by itself.
- `WorkflowEngine` executes registered workflow handlers from reusable workflow
  definitions and records structured events.
- Multi-agent runtime contracts define canonical roles, capabilities, typed
  tasks, artifacts, run results, gates, DAG workflow nodes, and shared workspace
  state used by the REPL, swarm, and embeddable runtime.

## CLI Relationship

The CLI is the first application moving onto the runtime. REPL and headless mode
now create a runtime facade to publish the active provider and tools to the
subagent bridge without changing user-facing behavior. Tool execution still keeps
the existing REPL confirmation and filtering path until the next migration phase.

## Runtime APIs

Runtime consumers can use Coco without the interactive CLI:

```ts
const runtimeSessionStore = createFileRuntimeSessionStore(".coco/runtime-sessions.json");
const toolRegistry = new ToolRegistry();

const runtime = await createAgentRuntime({
  providerType: "openai",
  model: "gpt-5.4",
  runtimeSessionStore,
  toolRegistry,
});

const session = runtime.createSession({
  mode: "ask",
  instructions: "Answer as a product assistant.",
  metadata: { tenantId: "corbat" },
});

const result = await runtime.runTurn({
  sessionId: session.id,
  content: "What can you help with?",
});
```

`runTurn()` appends user and assistant messages to the runtime session and emits
`turn.started`, `session.updated`, `turn.completed`, or `turn.failed` events.
Embeddable runtimes start with an empty tool registry unless the caller injects
one. CLI and coding-agent surfaces pass the full coding registry explicitly.
Embedders that need tool execution can provide a custom `RuntimeTurnRunner`
while reusing provider selection, permissions, sessions, and event logging.

Products should pass `runtimeContext` and `runtimePolicy` when embedding Coco for
customers. These contracts carry tenant, user, surface/channel, correlation ID,
data boundary, retention, cost budget, rate limits, and approval requirements.
Runtime sessions copy this metadata so events and audit logs can be traced back
to the client and channel that initiated the work.

RAG is exposed as injectable runtime primitives instead of a fixed vendor stack:
`DocumentLoader`, `Chunker`, `EmbeddingProvider`, `VectorStore`, `KnowledgeRetriever`,
`Reranker`, and `RagPipeline`. Product adapters can use Qdrant, pgvector,
Pinecone, OpenAI embeddings, Gemini embeddings, or a custom enterprise search
backend behind the same runtime contracts.

For streaming UI surfaces, use `streamTurn()`:

```ts
for await (const event of runtime.streamTurn({ sessionId: session.id, content })) {
  if (event.type === "text") sendToClient(event.text);
  if (event.type === "done") saveUsage(event.result.usage);
  if (event.type === "error") reportFailure(event.error);
}
```

Streaming currently covers text-only provider turns. Tool streaming should be
implemented as a separate runtime runner so embedders can keep confirmation and
permission UX explicit. If a consumer disconnects or stops iteration before the
`done` event, the runtime records `turn.cancelled` and does not persist a partial
assistant message. Streaming token usage is estimated with provider token counts
because most provider streaming APIs do not return final usage consistently.

Runtime consumers can execute registered tools through the same policy layer:

```ts
const result = await runtime.executeTool({
  sessionId: session.id,
  toolName: "read_file",
  input: { path: "README.md" },
});
```

Tools that can mutate state may return `requiresConfirmation`. The runtime
does not treat the CLI UI as implicit approval: embedders must pass
`confirmed: true` for those calls. Read-only modes still block write-capable
inputs such as `run_linter` with `fix: true`.

`createRuntimeSessionStore()` returns an in-memory store for tests and short
processes. `createFileRuntimeSessionStore(path)` persists sessions to one JSON
file for local products, prototypes, and replay fixtures. Hosted or multi-tenant
products should provide their own `RuntimeSessionStore` backed by their database
and tenant isolation model.

If `toolRegistry` is omitted, Coco uses the full coding-agent registry for CLI
compatibility. Embedded assistants should pass an explicit narrow registry with
only domain-safe tools.

For simple prototypes, `createRuntimeHttpServer(runtime)` exposes:

- `POST /sessions`
- `GET /sessions/:id`
- `POST /sessions/:id/messages`
- `GET /sessions/:id/events`
- `GET /state`

This adapter is deliberately minimal. Production web products must wrap it with
authentication, tenant isolation, quotas, rate limiting, streaming policy, and
audit storage.

## Workflow Execution

`WorkflowCatalog` remains the source for reusable workflow definitions. The
`WorkflowEngine` adds a small execution layer:

```ts
runtime.workflowEngine.registerHandler("provider-diagnosis", async (input) => {
  return { provider: input.provider, ok: true };
});

const run = await runtime.workflowEngine.run({
  workflowId: "provider-diagnosis",
  input: { provider: "openai" },
});
```

Handlers are explicit opt-ins for legacy or bespoke execution. Unknown workflows
still fail fast, and workflows without handlers execute through the runtime
`AgentGraphEngine` only when a real node executor is registered. The graph
engine does not simulate successful work by default; demos and tests must opt in
with `allowSimulated: true` and the dry-run executor. Handler failures and graph
failures return structured failed results and are recorded in the `EventLog`.

Workflow definitions now support executable graph metadata in addition to legacy
linear `steps`. New workflows should prefer `nodes`, `edges`, `gates`,
`parallelism`, conditions, timeouts, and `retryPolicy` so they can model
fan-out/fan-in execution, node retries, checkpoints, and quality gates. Legacy
`steps` are converted to a linear graph for planning, validation, and graph
execution, so existing workflows keep the same visible behavior once a runtime
executor is registered.

Multi-agent execution results should be represented as `AgentRunResult` with
typed `AgentArtifact` entries (`plan`, `findings`, `patchProposal`,
`testReport`, `riskReport`, or `summary`). Existing CLI-facing result strings
remain available for compatibility.

`SharedWorkspaceStore` is the controlled handoff surface between agents. Every
write requires provenance (`workflowRunId` and optional agent/node/task data),
role-filtered reads prevent ordinary implementation agents from receiving
risk-sensitive context by default, and graph artifact writes emit
`shared_state.updated` events. `FileSharedWorkspaceStore` preserves record IDs
when replaying local debug state. `SharedWorkspaceState` remains as a
compatibility facade over the in-memory store.

The multi-agent runtime has these architecture invariants:

- `src/runtime` must not import CLI, REPL, or swarm implementations.
- Legacy bridges are injected by adapters such as CLI/headless, not imported by
  runtime.
- Swarm is a runtime consumer, not a parallel orchestration stack.
- Agent roles and legacy role mappings are resolved through runtime contracts.
- Tool access is evaluated against agent capability, tool risk, and runtime
  permission policy.
- Required critical gates (`tests`, `coverage`, `security`, `quality-score`,
  `human-approval`) fail unless a concrete evaluator is configured.
- Graph execution emits correlated workflow, graph, agent, artifact, state,
  checkpoint, and gate events.

## Extensibility

Coco keeps Claude compatibility intact:

- `CLAUDE.md` remains the maintained project guidance source.
- `.claude/agents` and `.claude/skills` are not copied or removed.
- `AGENTS.md` stays a lightweight cross-agent index.

Reusable extension contracts live in the runtime layer:

- `SkillManifest` describes portable skill metadata.
- `RecipeManifest` describes repeatable workflows.
- `McpToolPolicy` describes MCP tool risk and allowed modes.
- `WorkflowCatalog` describes reusable workflow definitions such as release,
  provider diagnosis, PR review, best-of-n, and architect/editor/verifier.
- `AgentGraphEngine` executes workflow graphs and emits replayable runtime
  events.

## Product Boundary

The open-source core should include the CLI, runtime, common providers, generic
tools, skills, recipes, MCP support, and basic eval/replay harnesses.

Client-specific connectors, private workflows, hosted dashboards, enterprise
auditing, multi-user management, and SLA-backed support can stay in a separate
commercial layer.
