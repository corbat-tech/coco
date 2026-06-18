# Coco Runtime Web Assistant Example

This example shows how to embed Coco Runtime in a future web assistant such as
`corbat.tech` without depending on the interactive Coco CLI.

The important boundary is:

- the web app owns authentication, users, tenants, UI, and HTTP streaming;
- Coco Runtime owns provider selection, session state, permissions, events, and
  model turns;
- dangerous developer tools such as shell, filesystem writes, git push, and
  package publishing stay out of the web assistant unless explicitly registered.

```ts
import { createAgentRuntime, createFileRuntimeSessionStore } from "@corbat-tech/coco";
import { createProvider } from "@corbat-tech/coco";

const provider = await createProvider("openai", {
  model: "gpt-5.4",
});

const runtime = await createAgentRuntime({
  providerType: "openai",
  model: "gpt-5.4",
  provider,
  runtimeSessionStore: createFileRuntimeSessionStore(".coco/corbat-web-sessions.json"),
});

const session = runtime.createSession({
  mode: "ask",
  instructions: [
    "You are the Corbat website assistant.",
    "Answer from approved public product/service knowledge only.",
    "Never claim that you modified systems, sent emails, or created tickets unless a registered tool result proves it.",
  ].join("\\n"),
  metadata: {
    tenantId: "corbat",
    surface: "website",
  },
});

const answer = await runtime.runTurn({
  sessionId: session.id,
  content: "What can Corbat build for my company?",
});

console.log(answer.content);
```

## HTTP Adapter

For a web app, expose the runtime behind your own authenticated server:

```ts
import { createRuntimeHttpServer } from "@corbat-tech/coco";

const server = createRuntimeHttpServer(runtime);
server.listen(3000);
```

Minimal API:

```txt
POST /sessions
GET  /sessions/:id
POST /sessions/:id/messages
GET  /sessions/:id/events
GET  /state
```

Your production app should still wrap these endpoints with authentication,
tenant checks, quota checks, rate limiting, and audit logging.

## Recommended Web Tool Policy

Register only narrow, domain-specific tools for a public website assistant:

- `search_public_docs`
- `create_lead_draft`
- `request_contact_confirmation`
- `list_public_services`
- `estimate_project_scope`

Avoid registering these in a public web surface:

- unrestricted shell tools;
- arbitrary filesystem reads/writes;
- git write tools;
- deployment tools;
- package publishing tools;
- tools that expose secrets or private customer data.

## Production Checklist

- Use per-tenant/session IDs in `metadata`.
- Store `EventLog` in append-only infrastructure.
- Redact secrets before logging model/tool data.
- Require explicit user confirmation before external side effects.
- Use `PermissionPolicy` as a second line of defense even if the UI hides tools.
- Replay representative conversations before shipping model/provider changes.
