export function recallAt(ids: string[], grades: Map<string, number>, k: number): number {
  const positives = [...grades.values()].filter((grade) => grade > 0).length;
  if (!positives) return 0;
  const found = ids.slice(0, k).filter((id) => (grades.get(id) ?? 0) > 0).length;
  return found / positives;
}

export function mrr(ids: string[], grades: Map<string, number>): number {
  const rank = ids.findIndex((id) => (grades.get(id) ?? 0) > 0);
  return rank === -1 ? 0 : 1 / (rank + 1);
}

function dcg(grades: number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

export function ndcgAt(ids: string[], judgments: Map<string, number>, k: number): number {
  const actual = dcg(ids.slice(0, k).map((id) => judgments.get(id) ?? 0));
  const ideal = dcg([...judgments.values()].sort((a, b) => b - a).slice(0, k));
  return ideal === 0 ? 0 : actual / ideal;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
