export interface RetrievedSource {
  id: string;
  title: string;
  content: string;
  url?: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RagDocument {
  id: string;
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface RagChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface Citation {
  sourceId: string;
  title: string;
  url?: string;
  score?: number;
}

export interface RetrievalOptions {
  limit?: number;
  minScore?: number;
}

export interface DocumentLoader {
  load(): Promise<RagDocument[]>;
}

export interface Chunker {
  chunk(document: RagDocument): Promise<RagChunk[]>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(chunks: Array<RagChunk & { embedding: number[] }>): Promise<void>;
  search(embedding: number[], options?: RetrievalOptions): Promise<RetrievedSource[]>;
}

export interface Reranker {
  rerank(query: string, sources: RetrievedSource[]): Promise<RetrievedSource[]>;
}

export interface KnowledgeRetriever {
  search(query: string, options?: RetrievalOptions): Promise<RetrievedSource[]>;
}

export interface RagPipelineOptions {
  loader?: DocumentLoader;
  chunker?: Chunker;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
  retriever?: KnowledgeRetriever;
  reranker?: Reranker;
}

export interface RagPipeline {
  ingest(): Promise<{ documents: number; chunks: number }>;
  retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedSource[]>;
}

export interface InMemoryKnowledgeDocument {
  id: string;
  title: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export class InMemoryKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly documents: InMemoryKnowledgeDocument[]) {}

  async search(query: string, options: RetrievalOptions = {}): Promise<RetrievedSource[]> {
    const terms = tokenize(query);
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;

    return this.documents
      .map((document) => ({
        ...document,
        score: scoreDocument(document, terms),
      }))
      .filter((source) => source.score >= minScore && source.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export class SimpleTextChunker implements Chunker {
  constructor(private readonly options: { maxChars?: number; overlapChars?: number } = {}) {}

  async chunk(document: RagDocument): Promise<RagChunk[]> {
    const maxChars = Math.max(1, this.options.maxChars ?? 1200);
    const overlapChars = Math.max(0, Math.min(this.options.overlapChars ?? 120, maxChars - 1));
    const chunks: RagChunk[] = [];
    let index = 0;
    let offset = 0;

    while (offset < document.content.length) {
      const content = document.content.slice(offset, offset + maxChars);
      chunks.push({
        id: `${document.id}#${index}`,
        documentId: document.id,
        title: document.title,
        content,
        url: document.url,
        metadata: { ...document.metadata, chunkIndex: index },
      });
      index++;
      offset += maxChars - overlapChars;
    }

    return chunks;
  }
}

export class InMemoryVectorStore implements VectorStore {
  private chunks: Array<RagChunk & { embedding: number[] }> = [];

  async upsert(chunks: Array<RagChunk & { embedding: number[] }>): Promise<void> {
    const byId = new Map(this.chunks.map((chunk) => [chunk.id, chunk]));
    for (const chunk of chunks) byId.set(chunk.id, { ...chunk, embedding: [...chunk.embedding] });
    this.chunks = [...byId.values()];
  }

  async search(embedding: number[], options: RetrievalOptions = {}): Promise<RetrievedSource[]> {
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;
    return this.chunks
      .map((chunk) => ({
        id: chunk.id,
        title: chunk.title,
        content: chunk.content,
        url: chunk.url,
        score: cosineSimilarity(embedding, chunk.embedding),
        metadata: { ...chunk.metadata, documentId: chunk.documentId },
      }))
      .filter((source) => source.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export function createInMemoryKnowledgeRetriever(
  documents: InMemoryKnowledgeDocument[],
): KnowledgeRetriever {
  return new InMemoryKnowledgeRetriever(documents);
}

export function createSimpleTextChunker(options?: {
  maxChars?: number;
  overlapChars?: number;
}): Chunker {
  return new SimpleTextChunker(options);
}

export function createInMemoryVectorStore(): VectorStore {
  return new InMemoryVectorStore();
}

export function createRagPipeline(options: RagPipelineOptions): RagPipeline {
  return {
    async ingest() {
      if (
        !options.loader ||
        !options.chunker ||
        !options.embeddingProvider ||
        !options.vectorStore
      ) {
        return { documents: 0, chunks: 0 };
      }
      const documents = await options.loader.load();
      const chunks = (
        await Promise.all(documents.map((document) => options.chunker!.chunk(document)))
      ).flat();
      const embeddings = await options.embeddingProvider.embed(
        chunks.map((chunk) => chunk.content),
      );
      await options.vectorStore.upsert(
        chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] ?? [] })),
      );
      return { documents: documents.length, chunks: chunks.length };
    },
    async retrieve(query, retrievalOptions) {
      const sources = options.retriever
        ? await options.retriever.search(query, retrievalOptions)
        : await retrieveFromVectorPipeline(query, options, retrievalOptions);
      return options.reranker ? options.reranker.rerank(query, sources) : sources;
    },
  };
}

export function formatRetrievedSourcesForPrompt(sources: RetrievedSource[]): string {
  if (sources.length === 0) return "No retrieved sources.";
  return sources
    .map((source, index) => {
      const url = source.url ? `\nURL: ${source.url}` : "";
      return `[${index + 1}] ${source.title}${url}\n${source.content}`;
    })
    .join("\n\n");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
}

function scoreDocument(document: InMemoryKnowledgeDocument, terms: string[]): number {
  const haystack = `${document.title}\n${document.content}`.toLowerCase();
  if (terms.length === 0) return 0;
  const matches = terms.filter((term) => haystack.includes(term)).length;
  return matches / terms.length;
}

async function retrieveFromVectorPipeline(
  query: string,
  options: RagPipelineOptions,
  retrievalOptions?: RetrievalOptions,
): Promise<RetrievedSource[]> {
  if (!options.embeddingProvider || !options.vectorStore) return [];
  const [embedding] = await options.embeddingProvider.embed([query]);
  if (!embedding) return [];
  return options.vectorStore.search(embedding, retrievalOptions);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    aMagnitude += a[index]! ** 2;
    bMagnitude += b[index]! ** 2;
  }
  const denominator = Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
