import fs from 'node:fs';
import path from 'node:path';

export interface ScoreCheckpointCursor { publishedAt: string; id: string }
export type ScoreCheckpoint = { complete: true } | { complete: false; cursor: ScoreCheckpointCursor };

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
