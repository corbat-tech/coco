# Coco Sales Intake Assistant

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
