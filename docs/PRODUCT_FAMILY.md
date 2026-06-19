# Coco Product Family

Coco is organized as one npm package plus private workspace starters.

## Public package

`@corbat-tech/coco` remains the installable local package and CLI:

```bash
npm install -g @corbat-tech/coco
coco
```

It also exposes the reusable runtime API:

```ts
import { createAgentRuntime } from "@corbat-tech/coco/runtime";
import { supportRagAssistantPreset } from "@corbat-tech/coco/presets";
import { createSupportRagToolRegistry } from "@corbat-tech/coco/tools";
```

## Workspace products

The apps under `apps/*` are private product starters, not separately published
npm packages yet.

| Product | App | Purpose | Default tool posture |
| --- | --- | --- | --- |
| Coco Code | `apps/coco-code` | Trusted local coding agent | Full coding registry |
| Support/RAG | `apps/support-rag-assistant` | Support answers, drafts, escalation | `knowledge_search`, `create_support_draft`, `request_human_escalation` |
| Public Web | `apps/public-web-assistant` | Public FAQ and low-risk intake | No tools |
| Sales Intake | `apps/sales-intake-assistant` | Lead qualification summaries | `create_sales_lead_summary` |
| Internal Ops | `apps/internal-ops-assistant` | Internal action drafts | `create_internal_ops_draft` |

## Client replication model

For a client implementation, copy the closest starter into a client repo or a
client-specific app folder, then configure:

1. provider and model through environment variables;
2. tenant-specific prompts and metadata;
3. tool handlers that call the client's private systems;
4. a `RuntimeSessionStore` and `EventLog`, usually Postgres;
5. deployment-specific auth, rate limits, and observability.

The runtime remains shared. Product apps should stay thin: HTTP transport,
tenant configuration, tool handlers, and deployment wiring.

## Current maturity

This is ready as a professional-services starter and internal platform base. It
is not yet a hosted multi-tenant SaaS control plane. The next commercial step is
hardening one client deployment, then extracting repeated deployment code into
shared adapters.
