import type { DataBoundary, RuntimeRequestContext } from "./context.js";

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
  tenantId?: string;
  sourceId?: string;
  acl?: DocumentAcl;
  classification?: "public" | "internal" | "confidential" | "restricted";
  version?: string;
  updatedAt?: string;
  deletedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RagChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  url?: string;
  tenantId?: string;
  sourceId?: string;
  acl?: DocumentAcl;
  classification?: "public" | "internal" | "confidential" | "restricted";
  version?: string;
  updatedAt?: string;
  deletedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentAcl {
  public?: boolean;
  userIds?: string[];
  roles?: string[];
  groups?: string[];
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
  tenantId?: string;
  userId?: string;
  roles?: string[];
  groups?: string[];
  runtimeContext?: RuntimeRequestContext;
  dataBoundary?: DataBoundary;
  documentAccessPolicy?: DocumentAccessPolicy;
}

export interface DocumentAccessPolicy {
  canAccess(input: {
    document: RagDocument | RagChunk | InMemoryKnowledgeDocument;
    options: RetrievalOptions;
  }): boolean;
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
  runtimeContext?: RuntimeRequestContext;
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
  tenantId?: string;
  acl?: DocumentAcl;
  deletedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RagIngestionJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  result?: { documents: number; chunks: number };
  error?: string;
  run(): Promise<RagIngestionJob>;
}

export interface CitationVerificationResult {
  valid: boolean;
  unsupportedCitations: Citation[];
  missingSourceIds: string[];
}

export interface GroundednessEvaluation {
  grounded: boolean;
  score: number;
  blocked: boolean;
  reasons: string[];
}

export class InMemoryKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly documents: InMemoryKnowledgeDocument[]) {}

  async search(query: string, options: RetrievalOptions = {}): Promise<RetrievedSource[]> {
    const terms = tokenize(query);
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;
    const tenantId = tenantIdFromRetrievalOptions(options);

    return this.documents
      .filter((document) => sourceAccessible(document, { ...options, tenantId }))
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
        tenantId: document.tenantId,
        sourceId: document.sourceId,
        acl: document.acl,
        classification: document.classification,
        version: document.version,
        updatedAt: document.updatedAt,
        deletedAt: document.deletedAt,
        metadata: {
          ...document.metadata,
          tenantId: document.tenantId ?? document.metadata?.["tenantId"],
          sourceId: document.sourceId ?? document.metadata?.["sourceId"],
          acl: document.acl ?? document.metadata?.["acl"],
          classification: document.classification ?? document.metadata?.["classification"],
          version: document.version ?? document.metadata?.["version"],
          updatedAt: document.updatedAt ?? document.metadata?.["updatedAt"],
          deletedAt: document.deletedAt ?? document.metadata?.["deletedAt"],
          chunkIndex: index,
        },
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
    const tenantId = tenantIdFromRetrievalOptions(options);
    return this.chunks
      .filter((chunk) => sourceAccessible(chunk, { ...options, tenantId }))
      .map((chunk) => ({
        id: chunk.id,
        title: chunk.title,
        content: chunk.content,
        url: chunk.url,
        score: cosineSimilarity(embedding, chunk.embedding),
        metadata: {
          ...chunk.metadata,
          tenantId: chunk.tenantId ?? chunk.metadata?.["tenantId"],
          sourceId: chunk.sourceId ?? chunk.metadata?.["sourceId"],
          acl: chunk.acl ?? chunk.metadata?.["acl"],
          classification: chunk.classification ?? chunk.metadata?.["classification"],
          version: chunk.version ?? chunk.metadata?.["version"],
          updatedAt: chunk.updatedAt ?? chunk.metadata?.["updatedAt"],
          deletedAt: chunk.deletedAt ?? chunk.metadata?.["deletedAt"],
          documentId: chunk.documentId,
        },
      }))
      .filter((source) => source.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export function createDocumentAccessPolicy(input: {
  tenantId?: string;
  userId?: string;
  roles?: string[];
  groups?: string[];
  requireAcl?: boolean;
}): DocumentAccessPolicy {
  return {
    canAccess({ document, options }) {
      const tenantId = options.tenantId ?? input.tenantId;
      const userId = options.userId ?? input.userId;
      const roles = options.roles ?? input.roles ?? [];
      const groups = options.groups ?? input.groups ?? [];
      const metadata = document.metadata ?? {};
      if (document.deletedAt ?? metadata["deletedAt"]) return false;
      const documentTenantId = document.tenantId ?? stringMetadata(metadata, "tenantId");
      const visibility = stringMetadata(metadata, "visibility");
      if (tenantId && documentTenantId !== tenantId && visibility !== "global") return false;
      const acl = document.acl ?? (metadata["acl"] as DocumentAcl | undefined);
      if (!acl) return input.requireAcl !== true;
      if (acl.public === true) return true;
      if (userId && acl.userIds?.includes(userId)) return true;
      if (acl.roles?.some((role) => roles.includes(role))) return true;
      if (acl.groups?.some((group) => groups.includes(group))) return true;
      return false;
    },
  };
}

export function createRagIngestionJob(id: string, pipeline: RagPipeline): RagIngestionJob {
  const job: RagIngestionJob = {
    id,
    status: "pending",
    async run() {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      try {
        job.result = await pipeline.ingest();
        job.status = "completed";
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      } finally {
        job.completedAt = new Date().toISOString();
      }
      return { ...job };
    },
  };
  return job;
}

export function verifyCitations(
  citations: Citation[],
  sources: RetrievedSource[],
): CitationVerificationResult {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const unsupportedCitations: Citation[] = [];
  const missingSourceIds: string[] = [];
  for (const citation of citations) {
    const source = byId.get(citation.sourceId);
    if (!source) {
      missingSourceIds.push(citation.sourceId);
      unsupportedCitations.push(citation);
    }
  }
  return {
    valid: unsupportedCitations.length === 0,
    unsupportedCitations,
    missingSourceIds,
  };
}

export function evaluateGroundedness(
  answer: string,
  sources: RetrievedSource[],
): GroundednessEvaluation {
  const answerTerms = new Set(tokenize(answer));
  const sourceTerms = new Set(sources.flatMap((source) => tokenize(source.content)));
  const overlap = [...answerTerms].filter((term) => sourceTerms.has(term)).length;
  const score = answerTerms.size === 0 ? 0 : overlap / answerTerms.size;
  const injection = /ignore|override|bypass|reveal|exfiltrate/i.test(
    sources.map((source) => source.content).join("\n"),
  );
  const reasons: string[] = [];
  if (score < 0.2) reasons.push("Answer has low lexical support in retrieved sources.");
  if (injection) reasons.push("Retrieved sources contain prompt-injection indicators.");
  return {
    grounded: score >= 0.2 && !injection,
    score,
    blocked: injection,
    reasons,
  };
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
      const effectiveRetrievalOptions = mergeRetrievalOptionsWithRuntimeContext(
        retrievalOptions,
        options.runtimeContext,
      );
      const sources = options.retriever
        ? await options.retriever.search(query, effectiveRetrievalOptions)
        : await retrieveFromVectorPipeline(query, options, effectiveRetrievalOptions);
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

function mergeRetrievalOptionsWithRuntimeContext(
  options: RetrievalOptions | undefined,
  runtimeContext: RuntimeRequestContext | undefined,
): RetrievalOptions | undefined {
  if (!options && !runtimeContext) return undefined;
  return {
    ...options,
    runtimeContext: options?.runtimeContext ?? runtimeContext,
    tenantId:
      options?.tenantId ?? options?.runtimeContext?.tenant?.id ?? runtimeContext?.tenant?.id,
    dataBoundary:
      options?.dataBoundary ??
      options?.runtimeContext?.policy?.dataBoundary ??
      runtimeContext?.policy?.dataBoundary,
  };
}

function tenantIdFromRetrievalOptions(options: RetrievalOptions): string | undefined {
  return options.tenantId ?? options.runtimeContext?.tenant?.id;
}

function sourceAccessible(
  document: RagDocument | RagChunk | InMemoryKnowledgeDocument,
  options: RetrievalOptions,
): boolean {
  if (options.documentAccessPolicy) {
    return options.documentAccessPolicy.canAccess({ document, options });
  }
  const metadata = document.metadata ?? {};
  if (document.deletedAt ?? metadata["deletedAt"]) return false;
  if (!options.tenantId || options.dataBoundary?.allowCrossTenantMemory === true) return true;
  const sourceTenantId = document.tenantId ?? metadata["tenantId"];
  return sourceTenantId === options.tenantId || metadata["visibility"] === "global";
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

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
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
