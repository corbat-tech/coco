# Coco Internal Ops Assistant

Internal automation starter built on `@corbat-tech/coco/presets`.

## Run

```bash
pnpm build
pnpm --filter @corbat-tech/internal-ops-assistant dev
```

## Endpoints

- `GET /health`
- `POST /chat`
- `GET /events/:sessionId`

The only registered tool is `create_internal_ops_draft`. It prepares an audited
draft and deliberately does not execute ERP, CRM, billing, or account changes.
