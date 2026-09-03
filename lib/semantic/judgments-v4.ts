import { createHash } from 'crypto';
import type { BlindCandidate, V4Lane } from './eval-v4';

export type JudgmentConfidence = 'high' | 'medium' | 'low';
export type J5Judgment = 'creative_adaptation' | 'direct_application' | 'background' | 'none';
export type V4JudgmentOutput = number | { topic: number; packaging: number } | J5Judgment;
export type ResolvedV4Judgment = V4JudgmentOutput | 'unresolved';

export interface V4JudgmentRow {
  blind_id: string;
  input_hash: string;
  output: V4JudgmentOutput;
  confidence: JudgmentConfidence;
  rationale: string;
  judged_at: string;
}

const J5_LABELS = new Set<J5Judgment>(['creative_adaptation', 'direct_application', 'background', 'none']);

export function blindCandidateInputHash(candidate: BlindCandidate | Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
}

function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validOutput(lane: V4Lane, output: unknown): output is V4JudgmentOutput {
  if (lane === 'J1') return false;
  if (lane === 'J2') return integerBetween(output, 0, 3);
  if (lane === 'J3') {
    return !!output && typeof output === 'object'
      && integerBetween((output as { topic?: unknown }).topic, 0, 3)
      && integerBetween((output as { packaging?: unknown }).packaging, 0, 3)
      && Object.keys(output).sort().join(',') === 'packaging,topic';
  }
  if (lane === 'J4') return integerBetween(output, 0, 1);
  return typeof output === 'string' && J5_LABELS.has(output as J5Judgment);
}

export function validateJudgmentAssignment(
  lane: V4Lane,
  candidates: Array<BlindCandidate | Record<string, unknown>>,
  judgments: V4JudgmentRow[],
): void {
  const candidateById = new Map<string, BlindCandidate | Record<string, unknown>>();
  for (const candidate of candidates) {
    const blindId = candidate.blind_id;
    if (typeof blindId !== 'string' || !blindId) throw new Error('candidate blind_id is required');
    if (candidateById.has(blindId)) throw new Error(`duplicate candidate blind_id ${blindId}`);
    candidateById.set(blindId, candidate);
  }
  const seen = new Set<string>();
  for (const judgment of judgments) {
    if (seen.has(judgment.blind_id)) throw new Error(`duplicate judgment blind_id ${judgment.blind_id}`);
    seen.add(judgment.blind_id);
    const candidate = candidateById.get(judgment.blind_id);
    if (!candidate) throw new Error(`judgment references unknown blind_id ${judgment.blind_id}`);
    if (judgment.input_hash !== blindCandidateInputHash(candidate)) {
      throw new Error(`input hash mismatch for ${judgment.blind_id}`);
    }
    if (!validOutput(lane, judgment.output)) throw new Error(`${lane} output is invalid for ${judgment.blind_id}`);
    if (judgment.confidence !== 'high' && judgment.confidence !== 'medium' && judgment.confidence !== 'low') {
      throw new Error(`invalid confidence for ${judgment.blind_id}`);
    }
    if (!judgment.rationale?.trim()) throw new Error(`missing rationale for ${judgment.blind_id}`);
    if (!Number.isFinite(new Date(judgment.judged_at).getTime())) throw new Error(`invalid judged_at for ${judgment.blind_id}`);
  }
  if (seen.size !== candidateById.size) {
    throw new Error(`judgment coverage mismatch: ${seen.size}/${candidateById.size}`);
  }
}

function outputEqual(left: V4JudgmentOutput, right: V4JudgmentOutput): boolean {
  return typeof left === 'object' || typeof right === 'object'
    ? JSON.stringify(left) === JSON.stringify(right)
    : left === right;
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

export function resolveV4Judgments(
  lane: Exclude<V4Lane, 'J1'>,
  first: V4JudgmentOutput,
  second: V4JudgmentOutput,
  third?: V4JudgmentOutput,
): { resolved: ResolvedV4Judgment | null; needs_adjudication: boolean } {
  if (!validOutput(lane, first) || !validOutput(lane, second) || (third != null && !validOutput(lane, third))) {
    throw new Error(`${lane} judgment output is invalid`);
  }
  if (outputEqual(first, second)) return { resolved: first, needs_adjudication: false };
  if (third == null) return { resolved: null, needs_adjudication: true };
  if (lane === 'J2') {
    return { resolved: median([first as number, second as number, third as number]), needs_adjudication: false };
  }
  if (lane === 'J3') {
    const values = [first, second, third] as Array<{ topic: number; packaging: number }>;
    return {
      resolved: {
        topic: median(values.map((value) => value.topic)),
        packaging: median(values.map((value) => value.packaging)),
      },
      needs_adjudication: false,
    };
  }
  if (lane === 'J4') {
    return {
      resolved: ([first, second, third] as number[]).filter((value) => value === 1).length >= 2 ? 1 : 0,
      needs_adjudication: false,
    };
  }
  const counts = new Map<J5Judgment, number>();
  for (const value of [first, second, third] as J5Judgment[]) counts.set(value, (counts.get(value) ?? 0) + 1);
  const winner = [...counts.entries()].find(([, count]) => count >= 2)?.[0];
  return { resolved: winner ?? 'unresolved', needs_adjudication: false };
}
