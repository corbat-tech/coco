# WhatsApp Assistant

Coco does not ship vendor-specific WhatsApp SDK code in core. Use the webhook
adapter shape and connect Twilio or Meta in the client application.

## Pattern

```txt
WhatsApp provider webhook
  -> client API route
  -> createWebhookAssistantAdapter(runtime)
  -> Coco preset
  -> provider
```

## Recommended Presets

- `customerSupportAssistantPreset` for support.
- `salesIntakeAssistantPreset` for lead qualification.
- `appointmentBookingAssistantPreset` for scheduling.

## Safety

- Treat inbound messages as untrusted.
- Verify webhook signatures.
- Rate-limit by sender.
- Do not expose internal tools until identity is verified.
- Draft or escalate sensitive messages.
