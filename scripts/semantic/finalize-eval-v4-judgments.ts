import fs from 'fs/promises';
import path from 'path';
import type { BlindCandidate, FrozenV4TaskManifest, V4Lane } from '../../lib/semantic/eval-v4';
import {
  resolveV4Judgments,
  validateJudgmentAssignment,
  type ResolvedV4Judgment,
  type V4JudgmentOutput,
  type V4JudgmentRow,
} from '../../lib/semantic/judgments-v4';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const THIRD_FILES = [
  'judgments-pass-3-kb.json',
  'judgments-pass-3-retrieval.json',
  'judgments-pass-3-eval.json',
];

interface BlindTask {
  task: { id: string; lane: V4Lane; [key: string]: unknown };
  rubric: Record<string, unknown>;
  candidates: BlindCandidate[];
}

interface BlindArtifact {
  candidate_run_id: string;
  candidate_rankings_hash: string;
  pass: number;
  tasks: BlindTask[];
}

interface StoredAssignment {
  judge_identity: string;
  rubric_version: string;
  judgments: V4JudgmentRow[];
}

interface FirstTwoArtifact {
  version: 4;
  candidate_run_id: string;
  candidate_rankings_hash: string;
  assignments: Record<string, StoredAssignment>;
}

interface ThirdArtifact {
  version: 4;
  judge_identity: string;
  rubric_version: string;
  assignments: Array<{ pass: 3; task_id: string; judgments: V4JudgmentRow[] }>;
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, name), 'utf8')) as T;
}

async function finalize(): Promise<void> {
  const [taskManifest, passOne, passThree, firstTwo, ...thirdArtifacts] = await Promise.all([
    readJson<FrozenV4TaskManifest>('tasks.json'),
    readJson<BlindArtifact>('blind-pools-pass-1.json'),
    readJson<BlindArtifact>('blind-pools-pass-3.json'),
    readJson<FirstTwoArtifact>('judgments-pass-1-2.json'),
    ...THIRD_FILES.map((name) => readJson<ThirdArtifact>(name)),
  ]);
  if (passOne.candidate_run_id !== firstTwo.candidate_run_id
    || passOne.candidate_rankings_hash !== firstTwo.candidate_rankings_hash
    || passOne.candidate_run_id !== passThree.candidate_run_id) {
    throw new Error('judgment artifacts reference different candidate runs');
  }
  const thirdTaskById = new Map(passThree.tasks.map((task) => [task.task.id, task]));
  const thirdAssignments = new Map<string, StoredAssignment>();
  for (const third of thirdArtifacts) {
    for (const assignment of third.assignments) {
      if (assignment.pass !== 3 || thirdAssignments.has(assignment.task_id)) {
        throw new Error(`invalid or duplicate third-pass assignment ${assignment.task_id}`);
      }
      const task = thirdTaskById.get(assignment.task_id);
      if (!task) throw new Error(`third-pass assignment has no blind task ${assignment.task_id}`);
      validateJudgmentAssignment(task.task.lane, task.candidates, assignment.judgments);
      thirdAssignments.set(assignment.task_id, {
        judge_identity: third.judge_identity,
        rubric_version: third.rubric_version,
        judgments: assignment.judgments,
      });
    }
  }
  if (thirdAssignments.size !== thirdTaskById.size) {
    throw new Error(`third-pass task coverage mismatch: ${thirdAssignments.size}/${thirdTaskById.size}`);
  }

  const taskMetadata = new Map(taskManifest.tasks.map((task) => [task.id, task]));
  const rows: Array<{
    task_id: string;
    lane: V4Lane;
    split: 'dev' | 'heldout';
    blind_id: string;
    entity_id: string;
    pass_1: V4JudgmentOutput;
    pass_2: V4JudgmentOutput;
    pass_3?: V4JudgmentOutput;
    resolved: ResolvedV4Judgment;
  }> = [];
  let agreements = 0;
  let adjudicated = 0;
  let unresolved = 0;
  for (const task of passOne.tasks) {
    if (task.task.lane === 'J1') continue;
    const metadata = taskMetadata.get(task.task.id);
    if (!metadata) throw new Error(`unknown task ${task.task.id}`);
    const first = new Map(firstTwo.assignments[`1:${task.task.id}`]?.judgments.map((row) => [row.blind_id, row.output]));
    const second = new Map(firstTwo.assignments[`2:${task.task.id}`]?.judgments.map((row) => [row.blind_id, row.output]));
    const thirdById = new Map(thirdAssignments.get(task.task.id)?.judgments.map((row) => [row.blind_id, row.output]) ?? []);
    for (const candidate of task.candidates) {
      const firstOutput = first.get(candidate.blind_id);
      const secondOutput = second.get(candidate.blind_id);
      if (firstOutput == null || secondOutput == null) throw new Error(`${task.task.id}: missing first-two output`);
      const initial = resolveV4Judgments(task.task.lane as Exclude<V4Lane, 'J1'>, firstOutput, secondOutput);
      const thirdOutput = thirdById.get(candidate.blind_id);
      const resolution = initial.needs_adjudication
        ? resolveV4Judgments(task.task.lane as Exclude<V4Lane, 'J1'>, firstOutput, secondOutput, thirdOutput)
        : initial;
      if (resolution.needs_adjudication || resolution.resolved == null) {
        throw new Error(`${task.task.id}: unresolved adjudication ${candidate.blind_id}`);
      }
      if (initial.needs_adjudication) adjudicated += 1;
      else agreements += 1;
      if (resolution.resolved === 'unresolved') unresolved += 1;
      rows.push({
        task_id: task.task.id,
        lane: task.task.lane,
        split: metadata.split,
        blind_id: candidate.blind_id,
        entity_id: candidate.entity_id,
        pass_1: firstOutput,
        pass_2: secondOutput,
        ...(thirdOutput == null ? {} : { pass_3: thirdOutput }),
        resolved: resolution.resolved,
      });
    }
  }
  for (const [taskId, assignment] of thirdAssignments) {
    const expected = new Set(thirdTaskById.get(taskId)!.candidates.map((candidate) => candidate.blind_id));
    if (assignment.judgments.some((row) => !expected.has(row.blind_id))) throw new Error(`${taskId}: unexpected third judgment`);
  }
  await fs.writeFile(path.join(EVAL_DIR, 'resolved-judgments.json'), `${JSON.stringify({
    version: 4,
    candidate_run_id: passOne.candidate_run_id,
    candidate_rankings_hash: passOne.candidate_rankings_hash,
    rubric_version: 'semantic-v4-rubric-1',
    agreements,
    adjudicated,
    unresolved,
    judgments: rows,
  })}\n`);
  console.log(JSON.stringify({ judgments: rows.length, agreements, adjudicated, unresolved }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(finalize);
