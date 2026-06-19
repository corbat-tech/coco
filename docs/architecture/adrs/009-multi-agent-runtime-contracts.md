# ADR 009: Multi-Agent Runtime Contracts

## Status

Accepted

## Context

Coco already has several multi-agent surfaces: REPL subagents, the lower-level
agent executor/coordinator, swarm lifecycle roles, workflow metadata, runtime
permissions, and event logs. These pieces were useful but carried overlapping
concepts and mostly text-shaped results.

We need a professional multi-agent architecture that stays native to
TypeScript/Node, preserves current CLI/runtime behavior, and can be explained as
graph-based orchestration without adopting LangGraph.

## Decision

Introduce shared runtime contracts for multi-agent execution:

- Canonical agent roles, capabilities, budgets, tasks, artifacts, run results,
  gates, graph nodes, graph edges, and shared workspace state.
- Workflow definitions may expose DAG metadata (`nodes`, `edges`, `gates`,
  `parallelism`, `retryPolicy`) while legacy `steps` remain supported.
- Workflow registration validates graph shape before storing definitions.
- Existing executors keep legacy fields and additionally return structured
  artifacts and `AgentRunResult`.
- Runtime events include first-class agent and gate event names while preserving
  the existing `EventLog.record(type, data)` API.

## Consequences

- Existing commands and swarm flows can migrate incrementally.
- Runtime embedders get typed artifacts instead of parsing free-form text.
- Workflow metadata can represent fan-out/fan-in and gate-based execution.
- The codebase keeps a native implementation instead of introducing a Python
  graph framework dependency.
- Some duplication remains temporarily until all legacy agent surfaces are moved
  onto the shared contracts.
