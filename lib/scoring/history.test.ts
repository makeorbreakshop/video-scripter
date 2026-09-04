import { historyInsert, HISTORY_COLUMNS } from './history';

describe('score history insert', () => {
  test('an empty batch is null, not an invalid statement', () => {
    expect(historyInsert([])).toBeNull();
  });

  test('one row binds every column in order', () => {
    const ins = historyInsert([{ video_id: 'a', model_version: 'v5.0', score: 2.5 }])!;
    expect(ins.values).toHaveLength(HISTORY_COLUMNS.length);
    expect(ins.text).toContain('insert into video_score_history');
    expect(ins.text).toMatch(/\(\$1,\$2,.*\$17\)$/);
    expect(ins.values[0]).toBe('a');
    expect(ins.values[HISTORY_COLUMNS.indexOf('score')]).toBe(2.5);
  });

  test('missing fields become null so a partial row still inserts', () => {
    const ins = historyInsert([{ video_id: 'a', model_version: 'v5.0' }])!;
    expect(ins.values[HISTORY_COLUMNS.indexOf('baseline')]).toBeNull();
    expect(ins.values[HISTORY_COLUMNS.indexOf('extra')]).toBeNull();
  });

  test('extra is serialised, and an empty object writes null rather than {}', () => {
    const a = historyInsert([{ video_id: 'a', model_version: 'v5.0', extra: { q: 0.9 } }])!;
    expect(a.values[HISTORY_COLUMNS.indexOf('extra')]).toBe('{"q":0.9}');
    const b = historyInsert([{ video_id: 'a', model_version: 'v5.0', extra: {} }])!;
    expect(b.values[HISTORY_COLUMNS.indexOf('extra')]).toBeNull();
  });

  test('placeholders keep counting across rows', () => {
    const ins = historyInsert([
      { video_id: 'a', model_version: 'v5.0' },
      { video_id: 'b', model_version: 'v5.0' },
    ])!;
    expect(ins.values).toHaveLength(HISTORY_COLUMNS.length * 2);
    expect(ins.text).toContain(`$${HISTORY_COLUMNS.length + 1}`);
    expect(ins.values[HISTORY_COLUMNS.length]).toBe('b');
  });

  test('score 0 and views 0 survive the null coalesce', () => {
    const ins = historyInsert([{ video_id: 'a', model_version: 'v5.0', score: 0, views: 0 }])!;
    expect(ins.values[HISTORY_COLUMNS.indexOf('score')]).toBe(0);
    expect(ins.values[HISTORY_COLUMNS.indexOf('views')]).toBe(0);
  });
});
