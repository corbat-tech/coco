# Coco Public Web Assistant

Local development demo. It listens only on `127.0.0.1`; it is not a public or multiuser service. Client-supplied session/tenant IDs are not authentication. Do not expose it through a proxy or tunnel without implementing authenticated ownership and isolation.

`POST /chat` requires `Content-Type: application/json`, an object with a non-empty string `message`, and a body of at most 64 KiB. Invalid input returns 400, oversized input 413, unsupported content type 415, and internal failures a generic 500.

Local website-assistant example built on `@corbat-tech/coco/presets`.

## Run

```bash
pnpm build
pnpm --filter @corbat-tech/public-web-assistant dev
```

## Endpoints

- `GET /health`
- `POST /chat`
- `GET /events/:sessionId`

This demo registers no tools by default. Use it locally to prototype FAQ, service explanation, and intake conversations.
