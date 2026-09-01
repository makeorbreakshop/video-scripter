import { computeRankContext, ScoreRow } from './rank-core';

const row = (name: string, score: number): ScoreRow => ({
  player_name: name,
  best_score: score,
  total_battles: 10,
  total_wins: 5,
  last_played: '2026-09-01T00:00:00Z',
  accuracy: 50,
  game_duration_ms: 60000,
});

// Sorted best-first, as the API queries it.
const BOARD = [row('ace', 5000), row('bob', 4000), row('cat', 3000), row('dan', 2000), row('eve', 1000)];

describe('computeRankContext — the rank-0 regression', () => {
  it('a score lower than everything ranks LAST + 1, never 0', () => {
    const { playerRank, context } = computeRankContext(BOARD, 'brandon', 500);
    expect(playerRank).toBe(6); // below all 5, not #0
    const me = context.find((e) => e.is_current_player)!;
    expect(me.rank).toBe(6);
    expect(me.best_score).toBe(500);
  });

  it('score of 0 still ranks below the board, never 0', () => {
    const { playerRank } = computeRankContext(BOARD, 'brandon', 0);
    expect(playerRank).toBe(6);
  });

  it('empty leaderboard → rank 1', () => {
    const { playerRank, context } = computeRankContext([], 'brandon', 100);
    expect(playerRank).toBe(1);
    expect(context).toHaveLength(1);
    expect(context[0].is_current_player).toBe(true);
  });
});

describe('computeRankContext — normal paths', () => {
  it('exact match on the board uses the recorded row', () => {
    const { playerRank, context } = computeRankContext(BOARD, 'cat', 3000);
    expect(playerRank).toBe(3);
    const me = context.find((e) => e.is_current_player)!;
    expect(me.player_name).toBe('cat');
    expect(me.total_battles).toBe(10); // real row, not virtual
  });

  it('unrecorded mid-board score inserts virtually at the right spot', () => {
    const { playerRank, context } = computeRankContext(BOARD, 'brandon', 3500);
    expect(playerRank).toBe(3); // above cat(3000), below bob(4000)
    const names = context.map((e) => e.player_name);
    expect(names.indexOf('brandon')).toBe(names.indexOf('bob') + 1);
    // rows below the virtual insert shift down one rank
    expect(context.find((e) => e.player_name === 'cat')!.rank).toBe(4);
  });

  it('a tie with an existing score (different player) inserts at the tied position', () => {
    const { playerRank } = computeRankContext(BOARD, 'brandon', 3000);
    expect(playerRank).toBe(4); // below the existing 3000 (first `< score` is dan)
  });

  it('ranks in the window are consecutive and 1-based from the true offset', () => {
    const big = Array.from({ length: 30 }, (_, i) => row(`p${i}`, 10000 - i * 100));
    const { playerRank, context } = computeRankContext(big, 'p20', 10000 - 20 * 100);
    expect(playerRank).toBe(21);
    expect(context[0].rank).toBe(16); // window starts 5 above
    expect(context.map((e) => e.rank)).toEqual(
      Array.from({ length: context.length }, (_, i) => 16 + i)
    );
  });
});
