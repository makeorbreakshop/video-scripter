// The game-over rank route must not call the nonexistent RPC and must fetch a
// bounded window, never the whole table.
const calls: { table: string; ops: [string, any[]][] }[] = [];
const rpc = jest.fn();

function builder(table: string, result: any) {
  const rec = { table, ops: [] as [string, any[]][] };
  calls.push(rec);
  const b: any = {};
  for (const op of ['select', 'not', 'neq', 'gt', 'order', 'range', 'in']) {
    b[op] = (...args: any[]) => { rec.ops.push([op, args]); return b; };
  }
  b.then = (res: any, rej: any) => Promise.resolve(result(rec)).then(res, rej);
  return b;
}

// 12 games beat 1250; the window starts 5 above the player.
const games = Array.from({ length: 60 }, (_, i) => ({
  final_score: 1500 - i * 50, battles_played: 10, battles_won: 5,
  ended_at: '2026-11-07T00:00:00Z', game_duration_ms: 1, player_session_id: `s${i + 7}`,
}));

jest.mock('@/lib/supabase-lazy', () => ({
  getSupabase: () => ({
    rpc,
    from: (table: string) => builder(table, (rec: any) => {
      const sel = rec.ops.find((o: any) => o[0] === 'select');
      if (sel?.[1][1]?.head) return { count: 12, error: null };
      if (table === 'thumbnail_battle_players') {
        return { data: games.map((g) => ({ session_id: g.player_session_id, player_name: `p-${g.player_session_id}` })), error: null };
      }
      return { data: games, error: null };
    }),
  }),
}));

import { GET } from '@/app/api/thumbnail-battle/leaderboard-context/route';

test('ranks from a bounded window without the missing RPC', async () => {
  const res = await GET(new Request('https://x.test/api?player_name=p-s12&final_score=1250&use_games_table=true'));
  const body = await res.json();
  expect(rpc).not.toHaveBeenCalled();
  const windowQuery = calls.find((c) => c.table === 'thumbnail_battle_games' && c.ops.some((o) => o[0] === 'range'))!;
  expect(windowQuery.ops.find((o) => o[0] === 'range')![1]).toEqual([7, 66]);
  // games[i] sits at board position i+7; s12 (1250) is the first game not beating
  // 1250, so 12 games are above it and it ranks 13th.
  expect(body.player_rank).toBe(13);
  expect(body.leaderboard_context.find((e: any) => e.is_current_player).player_name).toBe('p-s12');
});
