# Next.js Public Assistant Example

This example shows the recommended shape for a public website assistant using
Coco Runtime without exposing coding-agent tools.

## Architecture

```txt
Browser widget
  -> /api/chat in your Next.js app
  -> Coco publicWebsiteAssistantPreset
  -> configured LLM provider
```

## Server Route Sketch

```ts
import {
  createHttpAssistantAdapter,
  publicWebsiteAssistantPreset,
} from "@corbat-tech/coco";

const runtime = await publicWebsiteAssistantPreset.createRuntime({
  brand: "Corbat",
  providerType: "openai",
  model: process.env.COCO_ASSISTANT_MODEL ?? "gpt-5.4",
});

const adapter = createHttpAssistantAdapter(runtime);

export async function POST(request: Request) {
  if (process.env.COCO_RUNTIME_ENABLED !== "true") {
    return Response.json({ error: "Coco Runtime assistant disabled" }, { status: 404 });
  }

  const body = await request.json();
  const result = await adapter.handleMessage({
    sessionId: body.sessionId,
    content: body.message,
    metadata: { surface: "website" },
  });

  return Response.json(result);
}
```

## Safety Defaults

- Use `publicWebsiteAssistantPreset` or a blueprint with `mode: ask`.
- Register no tools by default.
- Do not expose shell, filesystem, git, deploy, package publishing, secrets, or MCP tools.
- Add rate limiting, authentication for internal preview routes, and event-log redaction.
- Keep the existing simple chat endpoint as fallback until latency, quality, and cost are measured.
