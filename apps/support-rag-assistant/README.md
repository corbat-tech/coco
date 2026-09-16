# Coco Support/RAG Assistant

Local development demo. It listens only on `127.0.0.1`; it is not a public or multiuser service. Client-supplied session/tenant IDs are not authentication. Do not expose it through a proxy or tunnel without implementing authenticated ownership and isolation.

`POST /chat` requires `Content-Type: application/json`, an object with a non-empty string `message`, and a body of at most 64 KiB. Invalid input returns 400, oversized input 413, unsupported content type 415, and internal failures a generic 500.

First B2B product app built on Coco Runtime. It demonstrates a safe support
assistant that answers from approved knowledge, cites retrieved sources, drafts
support replies, and prepares confirmation-gated human escalations.

## Run

```bash
pnpm --filter @corbat-tech/support-rag-assistant dev
```

Environment:

```bash
COCO_PROVIDER=openai
COCO_MODEL=gpt-5.4
OPENAI_API_KEY=...
KNOWLEDGE_DIR=./knowledge
PORT=8787
```

## API

```bash
curl -X POST http://localhost:8787/chat \
  -H 'content-type: application/json' \
  -d '{"message":"How do I escalate an urgent billing issue?","tenantId":"demo"}'
```

The demo intentionally registers only support-safe tools. It does not expose
shell, git, arbitrary filesystem, deployment, or package publishing tools.

## Knowledge

Markdown files in `knowledge/` are loaded recursively. The first `# Heading`
becomes the source title; the relative file path becomes the document ID.

## Events

```bash
curl http://localhost:8787/events/<sessionId>
```

Human escalation remains blocked unless the request passes:

```json
{ "confirmedTools": ["request_human_escalation"] }
```

The escalation callback only returns a proposal: `queued: false` and an empty `escalationId`. Even with confirmation, this demo has no queue or delivery integration and does not contact a person.
