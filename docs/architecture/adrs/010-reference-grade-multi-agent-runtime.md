# ADR 010: Reference-Grade Multi-Agent Runtime

## Status

Accepted.

## Context

Coco already had useful multi-agent pieces: REPL subagents, `AgentExecutor`,
`AgentCoordinator`, swarm lifecycle, workflow metadata, runtime events, and
permission policies. The main architectural risk was duplication: several
surfaces could describe or execute agent work without one canonical runtime
contract.

Best-practice multi-agent systems use a small set of durable primitives:
typed agent contracts, executable graphs, controlled shared state, capability
policies, guardrails, traceable handoffs, and replayable events.

## Decision

Coco's canonical multi-agent architecture is the runtime layer:

- `src/runtime/multi-agent.ts` owns roles, capabilities, agent tasks, artifacts,
  run results, handoffs, graph definitions, gates, shared state stores, trace
  context, and tool-risk policy decisions.
- `WorkflowEngine` executes workflow graphs through `AgentGraphEngine` when no
  bespoke legacy handler is registered and a real node executor is configured.
  Dry-run execution is explicit and cannot be the production default.
- Legacy agent systems remain as adapters and must map roles through the runtime
  role mapper.
- Shared workspace writes require provenance and can be backed by memory or a
  file store for replay/debug. Graph writes emit `shared_state.updated`, and
  node completion emits checkpoint events for audit.
- Runtime events are normalized around workflow, graph, agent, artifact, gate,
  and shared-state operations.
- Permission decisions for subagents account for the spawned agent capability,
  not only the tool name.
- Legacy agent tool calls go through `RuntimeToolExecutor`, so allowlists,
  runtime permission policy, confirmation requirements, and tool events share
  one execution boundary.
- Required critical gates fail closed unless a concrete evaluator is supplied.

## Consequences

- New workflows should be authored as DAGs with nodes, dependencies, gates,
  retry policy, conditions, timeouts, and parallelism.
- CLI, REPL, and swarm must consume runtime contracts instead of redefining
  agent orchestration primitives.
- Architecture fitness tests protect runtime boundaries and tool execution
  boundaries.
- Existing public APIs stay compatible; legacy linear workflows and result
  strings remain supported while structured graph results become the preferred
  integration point.

## Remaining Legacy Adapters

- `src/agents/executor.ts` keeps its current public shape but emits canonical
  `AgentRunResult` and delegates tools through `RuntimeToolExecutor`.
- `src/cli/repl/agents/*` keeps the REPL UX but maps agent types to canonical
  runtime roles and delegates tools through `RuntimeToolExecutor`.
- `src/swarm/*` remains a runtime consumer during migration and should not
  introduce separate orchestration contracts.
- `src/runtime/multi-agent.ts` is still a compatibility barrel plus
  implementation module. It should be split into smaller runtime modules in the
  next cleanup pass without changing public exports.
