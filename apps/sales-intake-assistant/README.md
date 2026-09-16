# Coco Sales Intake Assistant

Local development demo. It listens only on `127.0.0.1`; it is not a public or multiuser service. Client-supplied session/tenant IDs are not authentication. Do not expose it through a proxy or tunnel without implementing authenticated ownership and isolation.

`POST /chat` requires `Content-Type: application/json`, an object with a non-empty string `message`, and a body of at most 64 KiB. Invalid input returns 400, oversized input 413, unsupported content type 415, and internal failures a generic 500.

Lead qualification starter built on `@corbat-tech/coco/presets`.

## Run

```bash
pnpm build
pnpm --filter @corbat-tech/sales-intake-assistant dev
```

## Endpoints

- `GET /health`
- `POST /chat`
- `GET /events/:sessionId`

The only registered tool is `create_sales_lead_summary`. It prepares an
internal summary and does not create CRM records.
