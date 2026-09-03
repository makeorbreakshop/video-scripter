export interface RankedInput {
  id: string;
  score: number;
}

export interface FusionList<T extends RankedInput> {
  source: string;
  weight: number;
  items: T[];
}

export interface FusedItem {
  id: string;
  score: number;
  sources: string[];
  ranks: Record<string, number>;
  rawScores: Record<string, number>;
}

function addFused(
  map: Map<string, FusedItem>,
  id: string,
  source: string,
  contribution: number,
  rank: number,
  rawScore: number,
): void {
  const current = map.get(id) ?? { id, score: 0, sources: [], ranks: {}, rawScores: {} };
  current.score += contribution;
  if (!current.sources.includes(source)) current.sources.push(source);
  current.sources.sort();
  current.ranks[source] = rank;
  current.rawScores[source] = rawScore;
  map.set(id, current);
}

function sorted(map: Map<string, FusedItem>): FusedItem[] {
  return [...map.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function weightedReciprocalRankFuse<T extends RankedInput>(lists: Array<FusionList<T>>, k = 60): FusedItem[] {
  const fused = new Map<string, FusedItem>();
  for (const list of lists) {
    list.items.forEach((item, index) => {
      addFused(fused, item.id, list.source, list.weight / (k + index + 1), index + 1, item.score);
    });
  }
  return sorted(fused);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

export function dbsfFuse<T extends RankedInput>(lists: Array<FusionList<T>>): FusedItem[] {
  const fused = new Map<string, FusedItem>();
  for (const list of lists) {
    const scores = list.items.map((item) => item.score);
    const m = mean(scores);
    const sd = standardDeviation(scores) || 1;
    list.items.forEach((item, index) => {
      const normalized = Math.max(0, Math.min(1, 0.5 + (item.score - m) / (3 * sd)));
      addFused(fused, item.id, list.source, list.weight * normalized, index + 1, item.score);
    });
  }
  return sorted(fused);
}

export function linearFuse<T extends RankedInput>(lists: Array<FusionList<T>>): FusedItem[] {
  const fused = new Map<string, FusedItem>();
  for (const list of lists) {
    const scores = list.items.map((item) => item.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = max - min || 1;
    list.items.forEach((item, index) => {
      addFused(fused, item.id, list.source, list.weight * ((item.score - min) / span), index + 1, item.score);
    });
  }
  return sorted(fused);
}
