# Public Assistant Runtime

Public website assistants should be safer and narrower than coding agents. A
visitor on a landing page does not need shell, filesystem, git, deploy, or MCP
access.

## Recommended Preset

Use `publicWebsiteAssistantPreset`:

```ts
import { publicWebsiteAssistantPreset } from "@corbat-tech/coco";

const runtime = await publicWebsiteAssistantPreset.createRuntime({
  brand: "Corbat",
  providerType: "openai",
  model: "gpt-5.4",
});
```

## Runtime Policy

- Default mode: `ask`.
- Default tools: none.
- Tool access: explicit allowlist only.
- External actions: require confirmation.
- Event logs: redact sensitive data.
- Rollout: use a feature flag and keep the existing chat endpoint as fallback.

## What To Measure

- Answer quality.
- Lead summary quality.
- Escalation rate.
- Latency.
- Cost per conversation.
- Guardrail findings.
- Provider errors.
