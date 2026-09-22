-- Corrected packaging gate: Jev unpackaged_p < 0.5 == packaged.
-- Stage-1 nano's video_framing.unpackaged over-fired one-sidedly; this column is
-- the corrected gate. nano's column is left untouched for comparison.
alter table public.video_framing
  add column if not exists unpackaged_v3 boolean;

comment on column public.video_framing.unpackaged_v3 is
  'Corrected packaging gate from jev unpackaged_p (video_packaging_scores) >= 0.5. NULL = not scored.';

update public.video_framing f
   set unpackaged_v3 = (s.unpackaged_p >= 0.5)
  from public.video_packaging_scores s
 where s.video_id = f.video_id
   and s.unpackaged_p is not null
   and (f.unpackaged_v3 is distinct from (s.unpackaged_p >= 0.5));

create index if not exists video_framing_unpackaged_v3_idx
  on public.video_framing (unpackaged_v3);
