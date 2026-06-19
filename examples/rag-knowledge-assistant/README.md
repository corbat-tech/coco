# RAG Knowledge Assistant Example

This example shows how to use Coco Runtime with a retriever interface instead of
locking the project to one vector database.

```ts
import {
  createInMemoryKnowledgeRetriever,
  ragKnowledgeAssistantPreset,
} from "@corbat-tech/coco";

const retriever = createInMemoryKnowledgeRetriever([
  {
    id: "services",
    title: "Services",
    content: "Corbat builds AI agents, software platforms, and automation.",
    url: "https://corbat.tech",
  },
]);

const runtime = await ragKnowledgeAssistantPreset.createRuntime({
  brand: "Corbat",
  providerType: "openai",
  model: "gpt-5.4",
  retriever,
});
```

## Production Retriever Options

Implement `KnowledgeRetriever` for your client stack:

- Supabase / Postgres + pgvector
- Pinecone
- Qdrant
- Notion
- Confluence
- Google Drive
- public web docs

## Safety Defaults

- Answer from retrieved or approved knowledge.
- Cite source titles.
- Say "I don't know" when sources are missing.
- Keep client-private connectors outside the open-source repo unless they are generic and safe.
