import {
  PRIORITY_LANE, channelFromSourceUrl, selectPriorityRows, orderByPublishedDesc,
  isPriorityImport, quotaUnits, type QueueRow,
} from './priority-lane';

const COVERED = 'UCabcdefghijklmnopqrstuv';
const OTHER = 'UCzyxwvutsrqponmlkjihgfe';
const covered = new Set([COVERED]);

const row = (o: Partial<QueueRow> & { id: number }): QueueRow => ({
  kind: 'video', ref: `v${o.id}`, mode: 'feed', source_url: null, seen_at: '2026-09-03T18:00:00Z', ...o,
});

describe('channelFromSourceUrl', () => {
  it('reads the poller and websub shapes', () => {
    expect(channelFromSourceUrl(`feed:/rss/${COVERED}`)).toBe(COVERED);
    expect(channelFromSourceUrl(`websub:${COVERED}`)).toBe(COVERED);
  });
  it('returns null for extension page paths and junk', () => {
    for (const u of ['feed:/', 'feed:/watch', 'feed:/results', 'feed:/@John_Malecki/', null, '', 'feed:/rss/nope']) {
      expect(channelFromSourceUrl(u)).toBeNull();
    }
  });
});

describe('selectPriorityRows', () => {
  it('takes feed/websub rows on covered channels and holds named uncovered ones', () => {
    const rows = [
      row({ id: 1, source_url: `feed:/rss/${COVERED}`, mode: 'websub' }),
      row({ id: 2, source_url: `feed:/rss/${OTHER}`, mode: 'websub' }),
      row({ id: 3, source_url: `websub:${COVERED}`, mode: 'websub' }),
    ];
    const { priority } = selectPriorityRows(rows, covered);
    expect(priority.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it('admits channel-less extension rows on spec — the BPS.space row shape', () => {
    // touch_queue id 51711: kind video, mode feed, source_url 'feed:/'. No channel in the row,
    // so it can only be admitted before the fetch and filtered after.
    const { priority } = selectPriorityRows([row({ id: 51711, ref: 'PpwewkOCFuE', source_url: 'feed:/' })], covered);
    expect(priority.map((r) => r.ref)).toEqual(['PpwewkOCFuE']);
  });

  it('ignores non-video kinds, clicks and videos already imported', () => {
    const rows = [
      row({ id: 1, kind: 'channel', source_url: `websub:${COVERED}` }),
      row({ id: 2, mode: 'click', source_url: `websub:${COVERED}` }),
      row({ id: 3, ref: 'have-it', source_url: `websub:${COVERED}` }),
    ];
    expect(selectPriorityRows(rows, covered, new Set(['have-it'])).priority).toEqual([]);
  });

  it('ranks certain-covered rows ahead of channel-less ones, newest sighting first', () => {
    const rows = [
      row({ id: 1, source_url: 'feed:/', seen_at: '2026-09-03T20:00:00Z' }),
      row({ id: 2, source_url: `feed:/rss/${COVERED}`, seen_at: '2026-09-03T10:00:00Z' }),
      row({ id: 3, source_url: `websub:${COVERED}`, seen_at: '2026-09-03T19:00:00Z' }),
    ];
    expect(selectPriorityRows(rows, covered).priority.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('caps at the per-run id budget and leaves the rest pending', () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      row({ id: i + 1, source_url: `websub:${COVERED}`, seen_at: new Date(1_760_000_000_000 + i * 1000).toISOString() }));
    const sel = selectPriorityRows(rows, covered);
    expect(sel.priority).toHaveLength(PRIORITY_LANE.maxIdsPerRun);
    expect(sel.overflow).toHaveLength(50);
    expect(sel.priority[0].id).toBe(250); // newest first
  });

  it('never returns the same video id twice', () => {
    const rows = [
      row({ id: 1, ref: 'dup', source_url: `websub:${COVERED}`, mode: 'websub' }),
      row({ id: 2, ref: 'dup', source_url: 'feed:/', mode: 'feed' }),
    ];
    expect(selectPriorityRows(rows, covered).priority).toHaveLength(1);
  });
});

describe('the lane runs when discovery cannot', () => {
  // The regression this whole module exists for: on 2026-09-02/03 the discovery ledger was at
  // or over DISCOVERY_DAILY_CAP (2,000 and 2,256 units measured), so the drainer exited before
  // reading the queue. The lane's admission decision must not consult the discovery budget.
  it('selects the same rows whatever the discovery ledger says', () => {
    const rows = [row({ id: 9, source_url: `websub:${COVERED}`, mode: 'websub' })];
    // selectPriorityRows takes no budget argument other than its own id cap: there is no way to
    // pass it a discovery figure, which is the point.
    expect(selectPriorityRows(rows, covered).priority.map((r) => r.id)).toEqual([9]);
  });

  it('charges its own ledger category, never discovery', () => {
    expect(PRIORITY_LANE.quotaCategory).toBe('tracked-upload');
    expect(PRIORITY_LANE.quotaCategory).not.toBe('discovery');
  });
});

describe('orderByPublishedDesc', () => {
  it('imports the newest upload first', () => {
    const items = [
      { id: 'old', snippet: { publishedAt: '2026-09-01T00:00:00Z' } },
      { id: 'new', snippet: { publishedAt: '2026-09-03T18:14:00Z' } },
      { id: 'none', snippet: null },
    ];
    expect(orderByPublishedDesc(items).map((i) => i.id)).toEqual(['new', 'old', 'none']);
  });
});

describe('isPriorityImport', () => {
  it('keeps a channel-less admission only when the fetch proves it covered', () => {
    expect(isPriorityImport(COVERED, covered)).toBe(true);
    expect(isPriorityImport(OTHER, covered)).toBe(false);
    expect(isPriorityImport(null, covered)).toBe(false);
  });
});

describe('quotaUnits', () => {
  it('is one unit per 50 ids', () => {
    expect(quotaUnits(0)).toBe(0);
    expect(quotaUnits(1)).toBe(1);
    expect(quotaUnits(50)).toBe(1);
    expect(quotaUnits(51)).toBe(2);
    expect(quotaUnits(PRIORITY_LANE.maxIdsPerRun)).toBe(4);
  });
});
