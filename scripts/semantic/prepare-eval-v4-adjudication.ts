import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { BlindCandidate, V4Lane } from '../../lib/semantic/eval-v4';
import {
  resolveV4Judgments,
  validateJudgmentAssignment,
  type V4JudgmentRow,
} from '../../lib/semantic/judgments-v4';
import { runMain } from './common';

const EVAL_DIR = path.resolve('docs/prd/semantic-eval-v4');
const JUDGMENT_FILES = [
  'judgments-eval-red-team.json',
  'judgments-kb-assumption-audit.json',
  'judgments-retrieval-sota-audit.json',
];

interface BlindTask {
  task: { id: string; lane: V4Lane; [key: string]: unknown };
  rubric: Record<string, unknown>;
  candidates: BlindCandidate[];
}

interface BlindArtifact {
  version: 4;
  candidate_run_id: string;
  candidate_rankings_hash: string;
  judge_contract: string;
  pass: number;
  tasks: BlindTask[];
}

interface JudgeArtifact {
  version: 4;
  judge_identity: string;
  rubric_version: string;
  assignments: Array<{
    pass: number;
    task_id: string;
    judgments: V4JudgmentRow[];
  }>;
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(EVAL_DIR, name), 'utf8')) as T;
}

function seededShuffle<T>(values: T[], seedText: string): T[] {
  let state = createHash('sha256').update(seedText).digest().readUInt32BE(0);
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const swap = Math.floor((state / 2 ** 32) * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

async function prepare(): Promise<void> {
  const [passOne, passTwo, ...judgeArtifacts] = await Promise.all([
    readJson<BlindArtifact>('blind-pools-pass-1.json'),
    readJson<BlindArtifact>('blind-pools-pass-2.json'),
    ...JUDGMENT_FILES.map((name) => readJson<JudgeArtifact>(name)),
  ]);
  if (passOne.candidate_run_id !== passTwo.candidate_run_id
    || passOne.candidate_rankings_hash !== passTwo.candidate_rankings_hash) {
    throw new Error('blind pass inputs do not match');
  }
  const blindTasks = new Map<string, Map<number, BlindTask>>();
  for (const artifact of [passOne, passTwo]) {
    for (const task of artifact.tasks) {
      const passes = blindTasks.get(task.task.id) ?? new Map<number, BlindTask>();
      passes.set(artifact.pass, task);
      blindTasks.set(task.task.id, passes);
    }
  }
  const assignments = new Map<string, { judge_identity: string; rubric_version: string; judgments: V4JudgmentRow[] }>();
  for (const artifact of judgeArtifacts) {
    if (artifact.version !== 4 || !artifact.judge_identity || !artifact.rubric_version) {
      throw new Error('invalid judge artifact header');
    }
    for (const assignment of artifact.assignments) {
      const key = `${assignment.pass}:${assignment.task_id}`;
      if (assignments.has(key)) throw new Error(`duplicate judge assignment ${key}`);
      const blindTask = blindTasks.get(assignment.task_id)?.get(assignment.pass);
      if (!blindTask) throw new Error(`judge assignment has no blind input ${key}`);
      if (blindTask.task.lane === 'J1') throw new Error(`J1 must use canonical-id scoring, not bulk judgment: ${key}`);
      validateJudgmentAssignment(blindTask.task.lane, blindTask.candidates, assignment.judgments);
      assignments.set(key, {
        judge_identity: artifact.judge_identity,
        rubric_version: artifact.rubric_version,
        judgments: assignment.judgments,
      });
    }
  }

  const expectedTaskIds = passOne.tasks.filter((task) => task.task.lane !== 'J1').map((task) => task.task.id);
  for (const taskId of expectedTaskIds) {
    for (const pass of [1, 2]) {
      if (!assignments.has(`${pass}:${taskId}`)) throw new Error(`missing judge assignment ${pass}:${taskId}`);
    }
  }
  if (assignments.size !== expectedTaskIds.length * 2) {
    throw new Error(`unexpected assignment count ${assignments.size}/${expectedTaskIds.length * 2}`);
  }

  let agreements = 0;
  let disagreements = 0;
  const adjudicationTasks: BlindTask[] = [];
  for (const taskId of expectedTaskIds) {
    const firstTask = blindTasks.get(taskId)!.get(1)!;
    const secondTask = blindTasks.get(taskId)!.get(2)!;
    const first = new Map(assignments.get(`1:${taskId}`)!.judgments.map((row) => [row.blind_id, row]));
    const second = new Map(assignments.get(`2:${taskId}`)!.judgments.map((row) => [row.blind_id, row]));
    const candidateById = new Map(firstTask.candidates.map((candidate) => [candidate.blind_id, candidate]));
    const unresolved: BlindCandidate[] = [];
    for (const blindId of candidateById.keys()) {
      const firstOutput = first.get(blindId)?.output;
      const secondOutput = second.get(blindId)?.output;
      if (firstOutput == null || secondOutput == null) throw new Error(`${taskId}: missing paired judgment ${blindId}`);
      const resolution = resolveV4Judgments(
        firstTask.task.lane as Exclude<V4Lane, 'J1'>,
        firstOutput,
        secondOutput,
      );
      if (resolution.needs_adjudication) {
        disagreements += 1;
        unresolved.push(candidateById.get(blindId)!);
      } else {
        agreements += 1;
      }
    }
    if (unresolved.length) {
      adjudicationTasks.push({
        task: firstTask.task,
        rubric: firstTask.rubric,
        candidates: seededShuffle(unresolved, `${passOne.candidate_run_id}\0${taskId}\0pass3`),
      });
    }
    if (firstTask.candidates.length !== secondTask.candidates.length) throw new Error(`${taskId}: pass pool size mismatch`);
  }

  await Promise.all([
    fs.writeFile(path.join(EVAL_DIR, 'judgments-pass-1-2.json'), `${JSON.stringify({
      version: 4,
      candidate_run_id: passOne.candidate_run_id,
      candidate_rankings_hash: passOne.candidate_rankings_hash,
      sources: judgeArtifacts.map((artifact, index) => ({
        file: JUDGMENT_FILES[index],
        judge_identity: artifact.judge_identity,
        rubric_version: artifact.rubric_version,
      })),
      assignments: Object.fromEntries(assignments),
    })}\n`),
    fs.writeFile(path.join(EVAL_DIR, 'blind-pools-pass-3.json'), `${JSON.stringify({
      version: 4,
      candidate_run_id: passOne.candidate_run_id,
      candidate_rankings_hash: passOne.candidate_rankings_hash,
      judge_contract: passOne.judge_contract,
      pass: 3,
      tasks: adjudicationTasks,
    })}\n`),
  ]);
  console.log(JSON.stringify({
    judged_pairs: agreements + disagreements,
    agreements,
    disagreements,
    agreement_rate: agreements / (agreements + disagreements),
    adjudication_tasks: adjudicationTasks.length,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(prepare);
