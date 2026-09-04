/** A stored V5 comparison belongs to the reading that produced it, not a future endpoint. */
export type ScoreComparison = { day: number; views: number; typical: number; score: number };
export type ComparisonScore = {
  model_version?: string;
  age_days?: number | null;
  views?: number | null;
  typical_at_age?: number | null;
  score?: number | null;
};

export function isSameAgeScore(score: ComparisonScore | null | undefined): boolean {
  if (!score) return false;
  return score.model_version ? score.model_version.startsWith('v5') : score.typical_at_age != null;
}

export function scoreComparison(score: ComparisonScore | null | undefined): ScoreComparison | null {
  if (!isSameAgeScore(score) || score?.score == null || score?.typical_at_age == null || score?.age_days == null || score?.views == null) return null;
  const day = Number(score.age_days), views = Number(score.views), typical = Number(score.typical_at_age), ratio = Number(score.score);
  if (![day, views, typical, ratio].every(Number.isFinite) || day < 0 || views < 0 || typical <= 0 || ratio < 0) return null;
  if (Math.abs(views / typical - ratio) > Math.max(1e-6, ratio * 1e-4)) return null;
  return { day, views, typical, score: ratio };
}
