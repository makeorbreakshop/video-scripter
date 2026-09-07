// The invariant this whole change exists for, checked against production rows:
//
//     score = views / (the line the page draws at the video's age)
//
// The page's dashed line and the score's denominator are the same function of age now
// (lib/app/typical-curve.ts), so this must hold exactly. It is checked against the STORED
// video_scores row, not a recomputation of it, so a divergence between what the scorer wrote
// and what the page draws fails here.
//
// Needs DATABASE_URL; skipped without one. Bounded read: a handful of freshly scored rows.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { q, getPool } from '../admin/db';
import { videoTypicalCurve } from './typical-curve';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('the typical line equals the score denominator, on production rows', () => {
  afterAll(async () => { await getPool().end(); });

  it('views / line(age) == the stored score, within 1%', async () => {
    // Two conditions, both about REPRODUCIBILITY, not about the invariant:
    //
    //  - freshly written rows: a prior's lifetime count keeps growing after the score is
    //    written, so a row scored days ago is compared against priors that have since moved.
    //  - `typical_measured_share = 1`: every prior contributed a real reading at this age. A
    //    prior with no samples contributes through its LIFETIME count read at now(), which is
    //    a moving number, and C(t) is a weighted MEDIAN -- so a hair of movement in the
    //    ordering does not nudge the answer, it snaps it to a different prior's value
    //    entirely. On the corpus's oldest videos, whose priors predate tracking, the stored
    //    C(t) and a recomputation minutes later legitimately differ by 2-4x. That is a fact
    //    about lifetime-count priors, not a disagreement between the line and the score, and
    //    pinning it here would only make this test flaky.
    const rows = await q<any>(
      `select video_id, views, age_days, score, typical_at_age
         from video_scores
        where scored_at > now() - interval '6 hours'
          and score is not null and typical_at_age is not null
          and age_days between 1 and 60
          and typical_measured_share >= 0.999
        order by scored_at desc
        limit 8`
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const age = Number(r.age_days);
      const [pt] = await videoTypicalCurve(r.video_id, [age]);
      expect(pt).toBeDefined();
      expect(pt.expected).not.toBeNull();
      const line = pt.expected!;
      // the line IS C(t): what the scorer stored as the denominator
      expect(Math.abs(line / Number(r.typical_at_age) - 1)).toBeLessThan(0.01);
      // ... and the headline multiple is readable straight off it
      expect(Math.abs(Number(r.views) / line / Number(r.score) - 1)).toBeLessThan(0.01);
    }
  }, 120_000);

  it('leaves a gap rather than a zero where it cannot say what normal is', async () => {
    const [row] = await q<any>(
      `select video_id from video_scores
        where scored_at > now() - interval '6 hours' and score is not null
        order by scored_at desc limit 1`
    );
    const pts = await videoTypicalCurve(row.video_id, [0, 0.0001, 30]);
    expect(pts.find((p) => p.day === 0)!.expected).toBeNull();
    for (const p of pts) expect(p.expected).not.toBe(0);
  }, 60_000);
});
