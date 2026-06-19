# Build Custom Agents With Coco

Coco provides a reusable runtime for custom agents while keeping the coding CLI
as the first product.

## Recommended Architecture

```txt
Your app
  -> channel adapter
  -> agent preset or blueprint
  -> Coco Runtime
  -> provider + approved tools
```

## Minimal Example

```ts
import {
  createAgentFromBlueprint,
  createBaseBlueprint,
} from "@corbat-tech/coco";

const blueprint = createBaseBlueprint({
  id: "client-assistant",
  name: "Client Assistant",
  description: "Safe assistant for a client website.",
  surface: "web",
  defaultMode: "ask",
  maturity: "experimental",
  instructions: "Answer from approved company information and escalate uncertainty.",
  allowedTools: [],
});

const assistant = await createAgentFromBlueprint(blueprint, {
  providerType: "openai",
  model: "gpt-5.4",
});
```

## Delivery Model

Use open-source Coco for generic runtime, presets, adapters, and examples. Keep
client-specific connectors, private workflows, dashboards, and deployment policy
in the client project.

## Production Checklist

- Start with no tools.
- Add one tool at a time.
- Require confirmation for external side effects.
- Use a dedicated service identity for integrations.
- Redact secrets and personal data in logs.
- Track latency, cost, errors, blocked tools, and escalations.
