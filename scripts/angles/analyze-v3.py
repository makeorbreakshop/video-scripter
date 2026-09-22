"""Analysis for the v3 angle assignment run: per-angle counts, agreement with both source
methods, a calibration proxy, and the unpackaged cross-check.

  python3 scripts/angles/analyze-v3.py --dir <out dir>
"""
import argparse, json, os, random, sys, collections, csv

def load_jsonl(p):
    rows = []
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: rows.append(json.loads(line))
            except json.JSONDecodeError: pass
    return rows

def jaccard(a, b):
    a, b = set(a), set(b)
    if not a and not b: return float('nan')
    return len(a & b) / len(a | b)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--repo', default='/Users/brandoncullum/video-scripter-v2/video-scripter')
    ap.add_argument('--scratch', required=True)
    args = ap.parse_args()

    tax = json.load(open(os.path.join(args.repo, 'scripts/angles/taxonomy-v3.json')))
    angles = tax['angles']
    fam = {f['family_id']: f['family_label'] for f in tax['families']}

    rows = load_jsonl(os.path.join(args.dir, 'assignments.jsonl'))
    by_video = {r['video_id']: r for r in rows}
    rows = list(by_video.values())
    meta = {}
    with open(os.path.join(args.dir, 'videos.tsv')) as f:
        for r in csv.reader(f, delimiter='\t'):
            if len(r) >= 3: meta[r[0]] = (r[1], r[2])

    out = []
    w = out.append
    w('# Angle library v3 — Jev assignment over the packaged stage-1 set\n')
    w(f'Videos answered: **{len(rows):,}** · angles: **{len(angles)}** · '
      f'model: **{sorted({r["model"] for r in rows})[0]}** · threshold 0.5\n')

    # ---- 1. per angle -------------------------------------------------------
    sets50, sets80, stats = {}, {}, {}
    for a in angles:
        aid = a['angle_id']
        ps = [(r['video_id'], r['probabilities'].get(aid, 0.0)) for r in rows]
        s50 = [v for v, p in ps if p >= 0.5]
        s80 = [v for v, p in ps if p >= 0.8]
        sets50[aid], sets80[aid] = s50, s80
        stats[aid] = dict(
            n50=len(s50), n80=len(s80),
            mean=sum(p for _, p in ps) / max(1, len(ps)),
            top=[v for v, p in sorted(ps, key=lambda x: -x[1])[:3]],
        )

    per_video = collections.Counter()
    for r in rows:
        per_video[sum(1 for p in r['probabilities'].values() if p >= 0.5)] += 1
    zero = per_video[0]
    mean_angles = sum(k * v for k, v in per_video.items()) / max(1, len(rows))
    cg = [r['curiosity_gap'] for r in rows if r['curiosity_gap'] is not None]
    sp = [r['specificity'] for r in rows if r['specificity'] is not None]
    w('\n## Coverage\n')
    w(f'**{zero:,} of {len(rows):,} videos ({100*zero/len(rows):.1f}%) match no angle at all**, and the mean '
      f'is {mean_angles:.2f} angles per video. A 38-angle closed library assigned by independent '
      'yes/no questions leaves half the corpus unlabelled — the model is refusing rather than '
      'shrugging, which is the behaviour the v1 catch-all entries were hiding.\n')
    w('| angles on a video | 0 | 1 | 2 | 3 | 4 | 5+ |')
    w('|---|--:|--:|--:|--:|--:|--:|')
    w(f'| videos | {per_video[0]:,} | {per_video[1]:,} | {per_video[2]:,} | {per_video[3]:,} | '
      f'{per_video[4]:,} | {sum(v for k, v in per_video.items() if k >= 5):,} |')
    w(f'\nContinuous readings (0-3 scale): curiosity gap mean {sum(cg)/len(cg):.2f}, '
      f'specificity mean {sum(sp)/len(sp):.2f}.\n')

    w('\n## Per angle\n')
    w('| angle | family | source | n ≥0.5 | n ≥0.8 | mean p | highest-probability titles |')
    w('|---|---|---|--:|--:|--:|---|')
    for a in sorted(angles, key=lambda a: -stats[a['angle_id']]['n50']):
        s = stats[a['angle_id']]
        titles = ' · '.join(meta.get(v, ('?', ''))[0][:80] for v in s['top'])
        w(f'| {a["angle_label"]} | {fam[a["family_id"]]} | {a["source"]} | {s["n50"]:,} | '
          f'{s["n80"]:,} | {s["mean"]:.3f} | {titles} |')

    # ---- 2a. agreement with the emergent v2 clusters ------------------------
    v2 = {a['angle_id']: a for a in json.load(
        open(os.path.join(args.scratch, 'framing-v2/angles_v2.json')))['angles']}
    emergent_map = {}
    for a in angles:
        for eid in ([a['emergent_id']] if a.get('emergent_id') else []) + \
                   [m.split()[0] for m in a.get('merged_from', []) if m.startswith('A0')]:
            emergent_map[a['angle_id']] = eid

    w('\n## Agreement with the emergent v2 clusters (Jaccard, Jev ≥0.5 vs cluster membership)\n')
    w('| angle | v2 cluster | cluster n | Jev n≥0.5 | overlap | Jaccard | recall of cluster |')
    w('|---|---|--:|--:|--:|--:|--:|')
    emergent_rows = []
    for aid, eid in sorted(emergent_map.items(), key=lambda kv: kv[1]):
        members = {m['video_id'] for m in v2[eid]['members']} & set(by_video)
        jev = set(sets50[aid])
        ov = len(members & jev)
        j = jaccard(members, jev)
        emergent_rows.append((aid, eid, members, j))
        w(f'| {aid} | {eid} {v2[eid]["name"]} | {len(members)} | {len(jev):,} | {ov} | '
          f'{j:.3f} | {ov / max(1, len(members)):.2f} |')

    # ---- 2b. agreement with v1 video_angles --------------------------------
    v1 = collections.defaultdict(set)
    v1_path = os.path.join(args.dir, 'v1_video_angles.tsv')
    for line in open(v1_path):
        vid, aid = line.rstrip('\n').split('\t')
        if vid in by_video: v1[aid].add(vid)

    w('\n## Agreement with the v1 enum tags (Jaccard, Jev ≥0.5 vs v1 `video_angles`)\n')
    w('Only the ~4k videos the v1 tagger ever saw carry v1 rows, so these are scoped to that overlap.\n')
    w('| angle | v1 n | Jev n≥0.5 | overlap | Jaccard | recall of v1 |')
    w('|---|--:|--:|--:|--:|--:|')
    v1_scope = set()
    for s in v1.values(): v1_scope |= s
    enum_j = []
    for a in sorted(angles, key=lambda a: a['angle_id']):
        aid = a['angle_id']
        if aid not in v1: continue
        jev = set(sets50[aid]) & v1_scope
        ov = len(v1[aid] & jev)
        j = jaccard(v1[aid], jev)
        enum_j.append((aid, j))
        w(f'| {aid} | {len(v1[aid])} | {len(jev):,} | {ov} | {j:.3f} | {ov / max(1, len(v1[aid])):.2f} |')

    # ---- 3. calibration proxy ----------------------------------------------
    w('\n## Calibration proxy — Jev probability vs v2 cluster membership\n')
    w('For the twelve angles that came out of the v2 clusters, pooled: of the videos Jev put in a '
      'probability bucket, what fraction the clustering also put in that angle. The clustering is '
      'not ground truth (it rejected 41% of the corpus as noise and only ran on 10,766 videos), so '
      'read the shape, not the level.\n')
    buckets = collections.defaultdict(lambda: [0, 0])
    for aid, eid, members, _ in emergent_rows:
        for r in rows:
            p = r['probabilities'].get(aid, 0.0)
            b = min(9, int(p * 10))
            buckets[b][0] += 1
            if r['video_id'] in members: buckets[b][1] += 1
    w('| p bucket | videos | cluster members | fraction |')
    w('|---|--:|--:|--:|')
    fracs = []
    for b in range(10):
        n, k = buckets[b]
        if not n: continue
        fracs.append((b, k / n))
        w(f'| {b/10:.1f}–{(b+1)/10:.1f} | {n:,} | {k:,} | {k/n:.4f} |')
    mono = all(fracs[i][1] <= fracs[i + 1][1] + 1e-9 for i in range(len(fracs) - 1))
    w(f'\n**Monotone: {"yes" if mono else "no"}.** '
      + ('The fraction rises with every bucket.' if mono else
         'Reversals: ' + ', '.join(f'{fracs[i][0]/10:.1f}→{fracs[i+1][0]/10:.1f}'
                                   for i in range(len(fracs) - 1) if fracs[i][1] > fracs[i + 1][1] + 1e-9)))

    # ---- 4. unpackaged cross-check -----------------------------------------
    unp = load_jsonl(os.path.join(args.dir, 'unpackaged_only.jsonl'))
    unp = {r['video_id']: r for r in unp}
    tp = fp = fn = tn = 0
    disagreements = []
    for r in rows:  # stage-1 said packaged
        jev_unp = r['unpackaged_p'] >= 0.5
        if jev_unp: fp += 1; disagreements.append((r['video_id'], 'stage1 packaged · Jev unpackaged', r['unpackaged_p']))
        else: tn += 1
    for vid, r in unp.items():  # stage-1 said unpackaged
        jev_unp = r['unpackaged_p'] >= 0.5
        if jev_unp: tp += 1
        else: fn += 1; disagreements.append((vid, 'stage1 unpackaged · Jev packaged', r['unpackaged_p']))
    w('\n## Unpackaged cross-check (Jev `unpackaged_p` ≥0.5 vs the stage-1 flag)\n')
    w('| | Jev unpackaged | Jev packaged |')
    w('|---|--:|--:|')
    w(f'| **stage-1 unpackaged** | {tp:,} | {fn:,} |')
    w(f'| **stage-1 packaged** | {fp:,} | {tn:,} |')
    total = tp + fp + fn + tn
    w(f'\nAgreement {100 * (tp + tn) / max(1, total):.1f}% over {total:,} videos · '
      f'{len(disagreements):,} disagreements.\n')

    unp_meta = {}
    p2 = os.path.join(args.dir, 'videos_unpackaged.tsv')
    if os.path.exists(p2):
        for r in csv.reader(open(p2), delimiter='\t'):
            if len(r) >= 3: unp_meta[r[0]] = (r[1], r[2])
    allmeta = {**meta, **unp_meta}
    random.seed(3)
    w('### 30 random disagreements to adjudicate\n')
    for vid, kind, p in random.sample(disagreements, min(30, len(disagreements))):
        t, ch = allmeta.get(vid, ('?', '?'))
        w(f'- `{p:.2f}` {kind} — **{t}** · {ch}')

    # ---- 5. drop candidates -------------------------------------------------
    w('\n## Drop candidates (n < 15 at ≥0.5)\n')
    thin = [a for a in angles if stats[a['angle_id']]['n50'] < 15]
    if not thin: w('None.')
    for a in sorted(thin, key=lambda a: stats[a['angle_id']]['n50']):
        s = stats[a['angle_id']]
        w(f'- **{a["angle_label"]}** (`{a["angle_id"]}`, {a["source"]}) — n={s["n50"]}, mean p {s["mean"]:.3f}')

    text = '\n'.join(out) + '\n'
    open(os.path.join(args.dir, '..', 'report.md'), 'w').write(text)
    json.dump({'stats': stats, 'sets50': sets50, 'sets80': sets80},
              open(os.path.join(args.dir, 'stats.json'), 'w'))
    print(text[:1500])

main()
