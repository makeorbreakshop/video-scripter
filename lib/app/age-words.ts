// One place for the age words the score copy uses, so the feed and the video page cannot drift
// into saying different things about the same video.
//
// v5 scores a video against what its channel typically has AT ITS AGE, so every "typical" number
// the app prints has to carry the age it was read at. Without it "typical 458K" beside a day-30
// projection reads as a day-30 number, which is what it used to be under v4 and no longer is.

/** "18h" / "3d" — the age a same-age comparison was read at. */
export function sameAge(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '–';
  if (days < 2) return `${Math.max(1, Math.round(days * 24))}h`;
  return `${Math.round(days)}d`;
}
