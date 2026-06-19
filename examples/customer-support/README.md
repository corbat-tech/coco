# Customer Support Assistant Example

Use this preset for support triage, answer drafts, and human escalation. It is
not intended to close tickets or change accounts without explicit approval.

```ts
import { customerSupportAssistantPreset } from "@corbat-tech/coco";

const runtime = await customerSupportAssistantPreset.createRuntime({
  brand: "Client Brand",
  providerType: "openai",
  model: "gpt-5.4",
});
```

## Recommended Flow

1. Classify the issue and urgency.
2. Retrieve approved support knowledge.
3. Draft a response.
4. Escalate uncertain, billing, account, legal, security, or angry-customer cases.
5. Require human approval before sending sensitive responses.
