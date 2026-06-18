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

## CLI Relationship

The CLI is the first application moving onto the runtime. REPL and headless mode
now create a runtime facade to publish the active provider and tools to the
subagent bridge without changing user-facing behavior. Tool execution still keeps
the existing REPL confirmation and filtering path until the next migration phase.

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
