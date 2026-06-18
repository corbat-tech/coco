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

## CLI Relationship

The CLI is the first application moving onto the runtime. REPL and headless mode
now create a runtime facade to publish the active provider and tools to the
subagent bridge without changing user-facing behavior. Tool execution still keeps
the existing REPL confirmation and filtering path until the next migration phase.

## Runtime APIs

Runtime consumers can use Coco without the interactive CLI:

```ts
const runtime = await createAgentRuntime({
  providerType: "openai",
  model: "gpt-5.4",
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
Embedders that need tool execution can provide a custom `RuntimeTurnRunner`
while reusing provider selection, permissions, sessions, and event logging.

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

Handlers are explicit opt-ins. Unknown workflows or workflows without handlers
fail fast, while handler failures return structured failed results and are
recorded in the `EventLog`.

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
  provider diagnosis, PR review, best-of-n, and architect/editor/verifier. It is
  descriptive metadata, not an executor.

## Product Boundary

The open-source core should include the CLI, runtime, common providers, generic
tools, skills, recipes, MCP support, and basic eval/replay harnesses.

Client-specific connectors, private workflows, hosted dashboards, enterprise
auditing, multi-user management, and SLA-backed support can stay in a separate
commercial layer.
