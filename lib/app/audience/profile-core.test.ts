import { isPresentationFeedback, ownerBuckets, verifiedBrief, type ThemeEvidence, type WinningVideo } from './profile-core';

const themes = [{ id: 1, type: 'frustration', label: 'Purchase anxiety', description: '',
  observation_count: 6, video_count: 4, author_count: 6, quotes: [] },
  { id: 2, type: 'request', label: 'Midjourney tutorial', description: '',
    observation_count: 5, video_count: 1, author_count: 5, quotes: [] },
  { id: 3, type: 'frustration', label: 'Video presentation complaints', description: '',
    observation_count: 4, video_count: 4, author_count: 4, quotes: [] }] as ThemeEvidence[];
const winners = [{ video_id: 'v1', title: 'Laser guide', views: 1000, subscribers_gained: 5, subs_per_1000: 5 }] as WinningVideo[];

test('keeps only existing, cross-video audience evidence and actual winning videos', () => {
  const brief = verifiedBrief({
    summary: { text: 'Buying decisions matter', theme_ids: [1] },
    core_beliefs: [
      { text: 'Test capability', theme_ids: [1] },
      { text: 'One-video interest', theme_ids: [2] },
      { text: 'Presentation is identity', theme_ids: [3] },
      { text: 'Invented', theme_ids: [999] },
    ],
    emotional_drivers: [], specific_interests: [],
    content_buckets: [{ title: 'Guides', text: 'Buying guides work', video_ids: ['v1'] },
      { title: 'Fake', text: 'Bad video', video_ids: ['v2'] }],
  }, themes, winners);
  expect(brief.core_beliefs.map((b) => b.text)).toEqual(['Test capability']);
  expect(brief.content_buckets.map((b) => b.title)).toEqual(['Guides']);
});

test('owner buckets require one or two actual winning owned-video URLs', () => {
  expect(ownerBuckets('Buying guides | https://www.youtube.com/watch?v=v1', winners)).toEqual([
    { title: 'Buying guides', video_ids: ['v1'] },
  ]);
  expect(() => ownerBuckets('Other | https://www.youtube.com/watch?v=foreign', winners)).toThrow(/owned/);
});

test('presentation complaints remain outside the audience brief', () => {
  expect(isPresentationFeedback({ ...themes[2], label: 'Clickbait Titles' })).toBe(true);
  expect(isPresentationFeedback({ ...themes[1], label: 'Communication Style and Pacing Requests' })).toBe(true);
  expect(isPresentationFeedback(themes[0])).toBe(false);
});
