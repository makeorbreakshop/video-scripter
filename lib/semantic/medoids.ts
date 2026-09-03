import { cosineSimilarity } from './topic-assignment';

export interface MedoidInput {
  id: string;
  vector: number[];
  publishedAt: Date;
}

export interface MedoidOutput {
  id: string;
  importance: number;
  clusterSize: number;
}

export function recencyImportance(publishedAt: Date, now = new Date(), lambdaPerDay = 0.01): number {
  const ageDays = Math.max(0, (now.getTime() - publishedAt.getTime()) / 86_400_000);
  return Math.exp(-lambdaPerDay * ageDays);
}

export function chooseMedoids(
  items: MedoidInput[],
  options: { maxMedoids?: number; similarityThreshold?: number; now?: Date; lambdaPerDay?: number } = {},
): MedoidOutput[] {
  const maxMedoids = options.maxMedoids ?? 8;
  const similarityThreshold = options.similarityThreshold ?? 0.85;
  const now = options.now ?? new Date();
  const lambda = options.lambdaPerDay ?? 0.01;
  const ranked = [...items].sort((a, b) => recencyImportance(b.publishedAt, now, lambda) - recencyImportance(a.publishedAt, now, lambda));
  const selected: MedoidInput[] = [];
  for (const item of ranked) {
    if (selected.length >= maxMedoids) break;
    if (selected.every((existing) => cosineSimilarity(existing.vector, item.vector) < similarityThreshold)) {
      selected.push(item);
    }
  }
  return selected.map((medoid) => {
    const members = items.filter((item) => cosineSimilarity(medoid.vector, item.vector) >= similarityThreshold);
    return {
      id: medoid.id,
      importance: members.reduce((sum, item) => sum + recencyImportance(item.publishedAt, now, lambda), 0),
      clusterSize: Math.max(1, members.length),
    };
  }).sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
}
