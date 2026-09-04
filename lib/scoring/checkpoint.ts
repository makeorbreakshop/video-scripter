import fs from 'node:fs';
import path from 'node:path';

export interface ScoreCheckpointCursor { publishedAt: string; id: string }
export type ScoreCheckpoint = { complete: true } | { complete: false; cursor: ScoreCheckpointCursor };

export function validateScoreCheckpointScope(options: {
  all: boolean; force: boolean; since: number | null; final: boolean; fit: boolean;
  v5: boolean; channels: string[];
}): void {
  if (!options.all || options.force || options.since || options.final || options.fit || options.v5 || options.channels.length) {
    throw new Error('--checkpoint is only valid with unfiltered incremental --all');
  }
}

export function readScoreCheckpoint(filePath: string): ScoreCheckpoint | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (value?.complete === true) return { complete: true };
    if (value?.complete === false && typeof value.cursor?.publishedAt === 'string' && typeof value.cursor?.id === 'string') return value;
    throw new Error('invalid checkpoint');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function writeScoreCheckpoint(filePath: string, value: ScoreCheckpoint): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  fs.renameSync(temporary, filePath);
}
