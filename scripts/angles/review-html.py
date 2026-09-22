"""The v3 review sheet: one block per angle, eight examples drawn nearest-first from the anchor's
niche, one per channel, spread across the three bands. Keep/kill radios and a JSON dump.

  python3 scripts/angles/review-html.py --dir <out dir>
"""
import argparse, csv, html, json, os, collections

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True)
    ap.add_argument('--repo', default='/Users/brandoncullum/video-scripter-v2/video-scripter')
    a = ap.parse_args()

    tax = json.load(open(os.path.join(a.repo, 'scripts/angles/taxonomy-v3.json')))
    fam = {f['family_id']: f['family_label'] for f in tax['families']}
    stats = json.load(open(os.path.join(a.dir, 'stats.json')))
    bands = json.load(open(os.path.join(a.dir, 'bands.json')))

    title, channel_name = {}, {}
    for r in csv.reader(open(os.path.join(a.dir, 'videos.tsv')), delimiter='\t'):
        if len(r) >= 3: title[r[0]], channel_name[r[0]] = r[1], r[2]
    chan, thumb = {}, {}
    for r in csv.reader(open(os.path.join(a.dir, 'video_meta.tsv')), delimiter='\t'):
        if len(r) >= 3: chan[r[0]], thumb[r[0]] = r[1], r[2]

    probs = {}
    with open(os.path.join(a.dir, 'assignments.jsonl')) as f:
        for line in f:
            if not line.strip(): continue
            r = json.loads(line)
            probs[r['video_id']] = r['probabilities']

    BAND_ORDER = {'anchor': 0, 'near': 1, 'adjacent': 2, 'far': 3}

    def examples(aid, k=8):
        """Nearest-first, one video per channel, and no band allowed to take more than half."""
        pool = []
        for vid in stats['sets50'][aid]:
            b = bands.get(chan.get(vid, ''))
            if not b: continue
            pool.append((b['rank'], vid, b['band']))
        pool.sort()
        picked, seen_chan, per_band = [], set(), collections.Counter()
        cap = max(2, k // 2)
        for _, vid, band in pool:
            c = chan[vid]
            if c in seen_chan or per_band[band] >= cap: continue
            picked.append((vid, band)); seen_chan.add(c); per_band[band] += 1
            if len(picked) == k: break
        # A thin angle should still show what it has rather than nothing.
        if len(picked) < k:
            for _, vid, band in pool:
                if any(vid == p[0] for p in picked): continue
                if chan[vid] in seen_chan: continue
                picked.append((vid, band)); seen_chan.add(chan[vid])
                if len(picked) == k: break
        return picked

    blocks = []
    for ang in sorted(tax['angles'], key=lambda x: -stats['stats'][x['angle_id']]['n50']):
        aid = ang['angle_id']; s = stats['stats'][aid]
        tiles = []
        for vid, band in examples(aid):
            p = probs[vid].get(aid, 0)
            tiles.append(
                f'<figure><img loading="lazy" src="{html.escape(thumb.get(vid,""))}" alt="">'
                f'<figcaption><b>{html.escape(title.get(vid,""))}</b>'
                f'<span>{html.escape(channel_name.get(vid,""))} · {band} · {p:.2f}</span>'
                f'</figcaption></figure>')
        blocks.append(f'''<section data-angle="{aid}">
<header><h2>{html.escape(ang['angle_label'])}</h2>
<p class="def">{html.escape(ang['definition'])}</p>
<p class="n">{s['n50']:,} · ≥0.8: {s['n80']:,}</p>
<p class="fam">{html.escape(fam[ang['family_id']])} · {ang['source']}</p>
<div class="verdict">
  <label><input type="radio" name="v_{aid}" value="keep"> keep</label>
  <label><input type="radio" name="v_{aid}" value="kill"> kill</label>
</div></header>
<div class="grid">{''.join(tiles)}</div></section>''')

    doc = f'''<!doctype html><meta charset="utf-8"><title>Angle library v3</title>
<style>
:root {{ color-scheme: light dark; --bg:#fff; --fg:#111; --mute:#666; --line:#e3e3e3; --card:#fafafa; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0e0e10; --fg:#eee; --mute:#999; --line:#2a2a2e; --card:#17171a; }} }}
* {{ box-sizing:border-box }}
body {{ margin:0; padding:24px 16px 96px; background:var(--bg); color:var(--fg);
  font:15px/1.45 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif; max-width:1180px; margin-inline:auto }}
h1 {{ font-size:20px; margin:0 0 24px }}
section {{ border-top:1px solid var(--line); padding:20px 0 }}
header {{ display:grid; grid-template-columns:1fr auto; gap:4px 24px; align-items:start; margin-bottom:12px }}
h2 {{ font-size:17px; margin:0; grid-column:1 }}
.def {{ grid-column:1; margin:2px 0 0; color:var(--mute); max-width:70ch }}
.n {{ grid-column:2; grid-row:1; margin:0; font-variant-numeric:tabular-nums; white-space:nowrap }}
.fam {{ grid-column:2; grid-row:2; margin:0; color:var(--mute); white-space:nowrap; text-align:right }}
.verdict {{ grid-column:2; grid-row:3; display:flex; gap:12px; justify-content:flex-end; margin-top:6px }}
.verdict label {{ cursor:pointer; color:var(--mute) }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px }}
figure {{ margin:0; background:var(--card); border-radius:6px; overflow:hidden }}
figure img {{ width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:var(--line) }}
figcaption {{ padding:8px; display:flex; flex-direction:column; gap:4px; font-size:13px }}
figcaption b {{ font-weight:600 }}
figcaption span {{ color:var(--mute); font-size:12px; font-variant-numeric:tabular-nums }}
#dump {{ position:fixed; right:16px; bottom:16px; padding:10px 16px; border:1px solid var(--line);
  border-radius:6px; background:var(--card); color:var(--fg); cursor:pointer; font:inherit }}
pre {{ white-space:pre-wrap; background:var(--card); padding:12px; border-radius:6px }}
@media (max-width:600px) {{ header {{ grid-template-columns:1fr }} .fam,.verdict {{ text-align:left; justify-content:flex-start }} }}
</style>
<h1>Angle library v3</h1>
{''.join(blocks)}
<pre id="out" hidden></pre>
<button id="dump">JSON</button>
<script>
document.getElementById('dump').onclick = () => {{
  const out = {{}};
  document.querySelectorAll('section[data-angle]').forEach(s => {{
    const c = s.querySelector('input:checked');
    out[s.dataset.angle] = c ? c.value : null;
  }});
  const pre = document.getElementById('out');
  pre.textContent = JSON.stringify(out, null, 2);
  pre.hidden = false;
  pre.scrollIntoView({{behavior:'smooth'}});
}};
</script>'''
    p = os.path.join(a.dir, '..', 'angles_v3.html')
    open(p, 'w').write(doc)
    print(p, len(doc))

main()
