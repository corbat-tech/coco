# Client Agent Integration

Coco can be used as a technical foundation for client-specific agents without
putting client-private connectors into the open-source repo.

## What Coco Provides

- Multi-provider runtime.
- Agent blueprints and presets.
- Tool registration and permission policy.
- Sessions, streaming, event logs, and guardrails.
- Generic adapters and examples.

## What Usually Stays Client-Specific

- CRM/helpdesk/calendar credentials.
- Private knowledge-base connectors.
- Company-specific workflows.
- Internal dashboards.
- Multi-user administration.
- Enterprise audit and retention policy.
- Hosting and SLA.

## Common Client Agents

- Public website assistant.
- RAG knowledge assistant.
- Support/RAG assistant.
- WhatsApp assistant.
- Customer support assistant.
- Sales intake assistant.
- Appointment booking assistant.
- Internal operations assistant.
- Coding and PR-review automation.

## Recommended First Product

Use `supportRagAssistantPreset` for the first commercial B2B product. It keeps
the coding-agent power out of public/support channels and registers only
explicit support tools:

- `knowledge_search`
- `create_support_draft`
- `request_human_escalation`

External actions such as human escalation must be confirmation-gated by the
embedding application. Do not reuse Coco Code's full tool registry in client
support assistants.
