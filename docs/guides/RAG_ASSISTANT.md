# RAG Assistant

Coco's RAG layer uses a small retriever interface instead of choosing a vector
database for every user.

## What Coco Does And Does Not Do

Coco is not the document connector or vector database. Google Drive, Notion,
Confluence, PDFs, and web pages still need a retriever or indexing layer.

Coco is the agent layer around that retriever:

- keeps provider/model configuration reusable;
- applies instructions such as "answer only from approved knowledge";
- adds guardrails and event logs;
- keeps sessions and channel metadata;
- lets the same RAG assistant run behind web, WhatsApp, support, or internal tools.

## Interface

```ts
interface KnowledgeRetriever {
  search(query: string, options?: RetrievalOptions): Promise<RetrievedSource[]>;
}
```

## Local Example

```ts
import {
  createInMemoryKnowledgeRetriever,
  ragKnowledgeAssistantPreset,
} from "@corbat-tech/coco";

const retriever = createInMemoryKnowledgeRetriever([
  { id: "docs", title: "Docs", content: "Approved company knowledge." },
]);

const runtime = await ragKnowledgeAssistantPreset.createRuntime({
  brand: "Client",
  providerType: "openai",
  model: "gpt-5.4",
  retriever,
});
```

## Production Backends

Implement the retriever for Supabase, Postgres/pgvector, Pinecone, Qdrant,
Notion, Confluence, Drive, or public docs. Keep credentials in the client app,
not in reusable Coco examples.
