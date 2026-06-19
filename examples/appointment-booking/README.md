# Appointment Booking Assistant Example

Coco's appointment preset is designed to collect scheduling intent and require
explicit confirmation before booking, moving, or cancelling appointments.

```ts
import { appointmentBookingAssistantPreset } from "@corbat-tech/coco";

const runtime = await appointmentBookingAssistantPreset.createRuntime({
  brand: "Client Clinic",
  providerType: "openai",
  model: "gpt-5.4",
  businessHours: "Monday-Friday, 09:00-17:00 Europe/Madrid",
});
```

## Production Tool Policy

- Availability lookup can be read-only.
- Booking, cancellation, and rescheduling must require explicit confirmation.
- Calendar credentials should belong to a dedicated service identity.
- Store audit events for every proposed and confirmed appointment action.
