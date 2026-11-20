import fs from 'node:fs';
import path from 'node:path';
import { createSchedulerState } from './scheduler-core';
import { SCHEDULER_CONFIG } from './scheduler-jobs';

const root = path.resolve(__dirname, '../..');

describe('SCHEDULER_CONFIG', () => {
  it('is internally consistent (unique names, known lanes)', () => {
    expect(() => createSchedulerState(SCHEDULER_CONFIG, Date.now())).not.toThrow();
  });

  it('points every job at a script that exists', () => {
    for (const job of SCHEDULER_CONFIG.jobs) expect(fs.existsSync(path.join(root, job.script))).toBe(true);
  });

  it('keeps no two DB-heavy jobs together: the heavy lane has capacity one', () => {
    expect(SCHEDULER_CONFIG.lanes.heavy).toBe(1);
    expect(SCHEDULER_CONFIG.exclusiveHolds).toEqual(expect.arrayContaining(['heavy', 'db']));
  });

  it('keeps the nightly fit and export out of the busy 03:00-04:30 window and exclusive', () => {
    for (const name of ['score-fit', 'export-tables']) {
      const job = SCHEDULER_CONFIG.jobs.find((j) => j.name === name)!;
      expect(job.exclusive).toBe(true);
      const minute = job.daily!.hour * 60 + job.daily!.minute;
      expect(minute < 180 || minute > 270).toBe(true);
    }
  });

  it('gives each job a hard ceiling above its own --max-seconds', () => {
    for (const job of SCHEDULER_CONFIG.jobs) {
      const i = job.args.indexOf('--max-seconds');
      if (i >= 0) expect(job.maxSeconds).toBeGreaterThan(Number(job.args[i + 1]));
    }
  });
});
