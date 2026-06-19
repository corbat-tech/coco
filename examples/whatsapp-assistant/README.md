# WhatsApp Assistant Example

This example uses Coco's generic webhook adapter shape. The open-source example
does not depend on Twilio or Meta SDKs; production apps should add those in the
client integration layer.

```ts
import {
  createWebhookAssistantAdapter,
  customerSupportAssistantPreset,
} from "@corbat-tech/coco";

const runtime = await customerSupportAssistantPreset.createRuntime({
  brand: "Client Brand",
  providerType: "openai",
  model: "gpt-5.4",
});

const adapter = createWebhookAssistantAdapter(runtime, { surface: "whatsapp" });

const reply = await adapter.handle({
  userId: inbound.from,
  content: inbound.text,
  metadata: { channel: "whatsapp" },
});
```

## Safety Defaults

- Treat WhatsApp as an untrusted public channel.
- Do not expose internal tools unless the user identity is verified.
- Use drafts and escalation for sensitive support cases.
- Add spam/rate limiting at the webhook boundary.
