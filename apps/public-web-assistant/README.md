# Coco Public Web Assistant

Safe public website starter built on `@corbat-tech/coco/presets`.

## Run

```bash
pnpm build
pnpm --filter @corbat-tech/public-web-assistant dev
```

## Endpoints

- `GET /health`
- `POST /chat`
- `GET /events/:sessionId`

This starter registers no tools by default. It is suitable for public FAQ,
service explanation, and low-risk intake flows.
