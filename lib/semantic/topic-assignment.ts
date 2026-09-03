export interface CentroidVector {
  cluster_id: number;
  vector: number[];
}

export function parsePgVector(value: string | number[] | null): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (!value) return [];
  const trimmed = value.trim();
  const body = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (!body.trim()) return [];
  return body.split(',').map((part) => {
    const number = Number(part.trim());
    if (!Number.isFinite(number)) throw new Error(`Invalid pgvector component: ${part}`);
    return number;
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export function assignNearestCentroid(
  vector: number[],
  centroids: CentroidVector[],
  threshold: number,
): { cluster_id: number; cosine: number } | null {
  let best: { cluster_id: number; cosine: number } | null = null;
  for (const centroid of centroids) {
    const cosine = cosineSimilarity(vector, centroid.vector);
    if (!best || cosine > best.cosine) best = { cluster_id: centroid.cluster_id, cosine };
  }
  return best && best.cosine >= threshold ? best : null;
}
