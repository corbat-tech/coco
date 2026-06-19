# Support/RAG Assistant

The Support/RAG assistant is the first B2B product built on Coco Runtime. It is
not a fork of Coco Code; it is a sibling product that reuses the same runtime
with a much safer tool profile.

## Product Shape

- Answers from approved knowledge through `KnowledgeRetriever`.
- Cites source titles when using retrieved content.
- Drafts support replies through `create_support_draft`.
- Prepares human escalations through `request_human_escalation`.
- Does not expose shell, git, arbitrary filesystem, deployment, or package
  publishing tools.

## Runtime Pattern

```ts
import {
  createInMemoryKnowledgeRetriever,
  supportRagAssistantPreset,
} from "@corbat-tech/coco";

const retriever = createInMemoryKnowledgeRetriever([
  { id: "policy", title: "Support Policy", content: "Approved knowledge." },
]);

const runtime = await supportRagAssistantPreset.createRuntime({
  brand: "Client",
  providerType: "openai",
  model: "gpt-5.4",
  retriever,
});
```

Use `apps/support-rag-assistant` for a runnable local demo.

## Local Knowledge

The starter loads Markdown files from `KNOWLEDGE_DIR` or `./knowledge` by
default. Files are loaded recursively:

```txt
knowledge/
  billing.md
  security.md
  support.md
```

The first `# Heading` becomes the source title, and the relative file path
becomes the document ID.

## HTTP Endpoints

- `GET /health`
- `POST /chat`
- `GET /events/:sessionId`

`POST /chat` accepts:

```json
{
  "message": "How do I escalate a billing issue?",
  "sessionId": "optional",
  "tenantId": "demo",
  "confirmedTools": []
}
```

To allow a human escalation, pass:

```json
{
  "confirmedTools": ["request_human_escalation"]
}
```

Without explicit confirmation, runtime policy blocks the escalation tool.

## Postgres Persistence

Hosted support agents should use the Postgres runtime adapters and apply:

```txt
src/runtime/migrations/001_runtime_postgres.sql
```

The adapters accept any query client compatible with `pg.Pool` / `pg.Client`.

## Commercial Boundary

Keep these in the client/commercial layer:

- private helpdesk/CRM/calendar credentials;
- tenant storage and retention policy;
- customer-specific knowledge connectors;
- SSO, RBAC, quotas, and audit dashboards;
- SLA-backed hosting and support.
