export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export interface Bm25SearchOptions {
  boosts?: ReadonlyMap<string, number>;
  excludeIds?: ReadonlySet<string>;
}

interface Posting {
  id: string;
  termFrequency: number;
}

export function tokenizeForBm25(text: string): string[] {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? [];
}

export class Bm25Index {
  private readonly documentCount: number;
  private readonly averageLength: number;
  private readonly documentLengths = new Map<string, number>();
  private readonly postings = new Map<string, Posting[]>();

  constructor(documents: Bm25Document[]) {
    for (const document of documents) {
      if (!document.id) throw new Error('BM25 document id is required');
      if (this.documentLengths.has(document.id)) throw new Error(`duplicate BM25 document id: ${document.id}`);
      const tokens = tokenizeForBm25(document.text);
      this.documentLengths.set(document.id, tokens.length);
      const frequencies = new Map<string, number>();
      for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      for (const [term, termFrequency] of frequencies) {
        const entries = this.postings.get(term) ?? [];
        entries.push({ id: document.id, termFrequency });
        this.postings.set(term, entries);
      }
    }
    this.documentCount = documents.length;
    const totalLength = [...this.documentLengths.values()].reduce((sum, length) => sum + length, 0);
    this.averageLength = this.documentCount ? totalLength / this.documentCount : 0;
  }

  search(query: string, limit = 100, options: Bm25SearchOptions = {}): Bm25Hit[] {
    if (limit <= 0 || this.documentCount === 0) return [];
    const k1 = 1.2;
    const b = 0.75;
    const scores = new Map<string, number>();
    const queryFrequencies = new Map<string, number>();
    for (const term of tokenizeForBm25(query)) {
      queryFrequencies.set(term, (queryFrequencies.get(term) ?? 0) + 1);
    }
    for (const [term, queryFrequency] of queryFrequencies) {
      const entries = this.postings.get(term);
      if (!entries?.length) continue;
      const documentFrequency = entries.length;
      const inverseDocumentFrequency = Math.log(
        1 + (this.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const queryWeight = 1 + Math.log(queryFrequency);
      for (const entry of entries) {
        if (options.excludeIds?.has(entry.id)) continue;
        const documentLength = this.documentLengths.get(entry.id) ?? 0;
        const normalization = this.averageLength
          ? 1 - b + b * documentLength / this.averageLength
          : 1;
        const termScore = inverseDocumentFrequency
          * (entry.termFrequency * (k1 + 1))
          / (entry.termFrequency + k1 * normalization);
        scores.set(entry.id, (scores.get(entry.id) ?? 0) + queryWeight * termScore);
      }
    }
    for (const [id, boost] of options.boosts ?? []) {
      if (!this.documentLengths.has(id) || options.excludeIds?.has(id) || !Number.isFinite(boost)) continue;
      scores.set(id, (scores.get(id) ?? 0) + boost);
    }
    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort(([leftId, leftScore], [rightId, rightScore]) => rightScore - leftScore || leftId.localeCompare(rightId))
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));
  }
}
