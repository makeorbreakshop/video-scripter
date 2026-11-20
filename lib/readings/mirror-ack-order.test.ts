import { MIRROR_ACK_SQL } from './export-row-mirror';

// 2026-11-20: export-tables' ack deadlocked (40P01) against capture_mirror_changes(), which marks
// keys ORDER BY k. The ack must take its row locks in the same key order before deleting.
describe('mirror ack lock order', () => {
  it('locks the acknowledged marks in key order before deleting them', () => {
    const sql = MIRROR_ACK_SQL.replace(/\s+/g, ' ');
    expect(sql).toMatch(/locked AS \( SELECT .* FROM mirror_dirty d .* ORDER BY d\.key FOR UPDATE OF d \)/);
    expect(sql).toMatch(/DELETE FROM mirror_dirty d USING locked l/);
    expect(sql).not.toMatch(/DELETE FROM mirror_dirty d USING jsonb_to_recordset/);
  });
});
