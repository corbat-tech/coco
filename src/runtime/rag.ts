export interface RetrievedSource {
  id: string;
  title: string;
  content: string;
  url?: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalOptions {
  limit?: number;
  minScore?: number;
}

export interface KnowledgeRetriever {
  search(query: string, options?: RetrievalOptions): Promise<RetrievedSource[]>;
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

export function createInMemoryKnowledgeRetriever(
  documents: InMemoryKnowledgeDocument[],
): KnowledgeRetriever {
  return new InMemoryKnowledgeRetriever(documents);
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
