jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q } from '../admin/db';
import { parseSort, SORTS, GRID_PAGE, channelVideos } from './channel-page';

const mq = q as jest.Mock;
beforeEach(() => { mq.mockReset(); mq.mockResolvedValue([]); });

describe('parseSort', () => {
  it('defaults to newest-first, so an unscored channel still reads chronologically', () => {
    expect(parseSort(undefined)).toBe('published');
    expect(parseSort(null)).toBe('published');
    expect(parseSort('')).toBe('published');
    expect(parseSort('nonsense')).toBe('published');
  });
  it('honours the sorts the tabs offer', () => {
    expect(parseSort('score')).toBe('score');
    expect(parseSort('views')).toBe('views');
    expect(parseSort(['views'])).toBe('views');
  });
});

describe('SORTS', () => {
  it('puts unscored and undated rows last rather than treating them as zero', () => {
    for (const clause of Object.values(SORTS)) expect(clause).toMatch(/nulls last/);
  });
  it('never filters — an unscored video still belongs in the grid', () => {
    for (const clause of Object.values(SORTS)) expect(clause).not.toMatch(/where|is not null/i);
  });
});

it('pages enough rows that a normal channel fits in one screenful', () => {
  expect(GRID_PAGE).toBeGreaterThanOrEqual(60);
});

describe('channelVideos SQL', () => {
  const sql = () => String(mq.mock.calls[0][0]).replace(/\s+/g, ' ');

  it('picks the page first, then decorates only those rows', async () => {
    await channelVideos('UC1', 'published', 60, 0);
    const text = sql();
    // The LIMIT sits in the CTE, ahead of the packaging laterals.
    expect(text).toMatch(/with page as \(.*limit \$2 offset \$3 \)/);
    const cte = text.slice(0, text.indexOf('limit $2 offset $3'));
    expect(cte).not.toContain('thumbnail_versions');
    expect(cte).not.toContain('title_versions');
    expect(text).toContain('from page v');
    expect(mq.mock.calls[0][1]).toEqual(['UC1', 61, 0]);
  });

  it('leaves video_scores out of the page CTE unless the sort needs it', async () => {
    await channelVideos('UC1', 'views');
    const cte = sql().slice(0, sql().indexOf('limit $2 offset $3'));
    expect(cte).not.toContain('video_scores');
  });

  it('joins video_scores inside the CTE for the score sort', async () => {
    await channelVideos('UC1', 'score');
    const cte = sql().slice(0, sql().indexOf('limit $2 offset $3'));
    expect(cte).toContain('left join video_scores s on s.video_id = v.id');
  });

  it('re-applies the order after decorating, so the join does not reshuffle the page', async () => {
    await channelVideos('UC1', 'views');
    expect(sql().lastIndexOf('order by v.view_count desc nulls last'))
      .toBeGreaterThan(sql().indexOf('from page v'));
  });

  it('asks for one row past the page and reports hasMore from it', async () => {
    const row = (id: string) => ({ id, title: 't', published_at: '2026-01-01T00:00:00.000Z', view_count: 1 });
    mq.mockResolvedValue([row('a'), row('b'), row('c')]);
    const page = await channelVideos('UC1', 'published', 2);
    expect(page.hasMore).toBe(true);
    expect(page.videos.map((v) => v.id)).toEqual(['a', 'b']);
    mq.mockResolvedValue([row('a'), row('b')]);
    expect((await channelVideos('UC1', 'published', 2)).hasMore).toBe(false);
  });

  it('keeps the range predicate in the CTE where the LIMIT can use it', async () => {
    await channelVideos('UC1', 'published', 60, 0, '30d');
    const cte = sql().slice(0, sql().indexOf('limit $2 offset $3'));
    expect(cte).toContain("v.published_at >= now() - interval '30 days'");
  });
});
