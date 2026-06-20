import { describe, expect, it } from "vitest";
import {
  createInMemoryKnowledgeRetriever,
  createInMemoryVectorStore,
  createRagPipeline,
  createSimpleTextChunker,
  formatRetrievedSourcesForPrompt,
  type EmbeddingProvider,
} from "./rag.js";

const keywordEmbeddingProvider: EmbeddingProvider = {
  async embed(texts) {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return [
        lower.includes("refund") ? 1 : 0,
        lower.includes("invoice") ? 1 : 0,
        lower.includes("shipping") ? 1 : 0,
      ];
    });
  },
};

describe("RAG runtime primitives", () => {
  it("keeps the existing keyword retriever compatible", async () => {
    const retriever = createInMemoryKnowledgeRetriever([
      { id: "doc-1", title: "Refunds", content: "Refunds take five days." },
      { id: "doc-2", title: "Shipping", content: "Shipping takes two days." },
    ]);

    const results = await retriever.search("refund policy");

    expect(results[0]).toMatchObject({ id: "doc-1", title: "Refunds" });
    expect(formatRetrievedSourcesForPrompt(results)).toContain("Refunds take five days.");
  });

  it("ingests documents and retrieves from an injected vector pipeline", async () => {
    const vectorStore = createInMemoryVectorStore();
    const pipeline = createRagPipeline({
      loader: {
        async load() {
          return [
            { id: "doc-1", title: "Refunds", content: "Refund requests need an invoice." },
            { id: "doc-2", title: "Shipping", content: "Shipping tracking arrives by email." },
          ];
        },
      },
      chunker: createSimpleTextChunker({ maxChars: 80, overlapChars: 0 }),
      embeddingProvider: keywordEmbeddingProvider,
      vectorStore,
    });

    await expect(pipeline.ingest()).resolves.toEqual({ documents: 2, chunks: 2 });

    const results = await pipeline.retrieve("I need a refund", { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Refunds",
      metadata: { documentId: "doc-1", chunkIndex: 0 },
    });
  });

  it("allows reranking without coupling to a vector store implementation", async () => {
    const pipeline = createRagPipeline({
      retriever: createInMemoryKnowledgeRetriever([
        { id: "doc-1", title: "General", content: "refund invoice" },
        { id: "doc-2", title: "Escalation", content: "refund invoice urgent" },
      ]),
      reranker: {
        async rerank(_query, sources) {
          return [...sources].sort((a, b) => b.title.localeCompare(a.title));
        },
      },
    });

    const results = await pipeline.retrieve("refund invoice");

    expect(results.map((result) => result.title)).toEqual(["General", "Escalation"]);
  });
});
