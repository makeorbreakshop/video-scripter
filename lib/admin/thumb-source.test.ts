import { resolveThumbSource, ytCdnUrl } from './thumb-source';

describe('resolveThumbSource', () => {
  const base = { videoId: 'abc123XYZ_-', version: 2, latestVersion: 3 };

  test('serves the local archive file when it exists', () => {
    expect(resolveThumbSource({ ...base, fileExists: true })).toEqual({ kind: 'file', path: 'data/thumbnails/abc123XYZ_-_v2.jpg' });
  });

  test('redirects to the YouTube CDN when the archive is missing but this is the latest version', () => {
    expect(resolveThumbSource({ ...base, version: 3, fileExists: false })).toEqual({
      kind: 'redirect',
      url: 'https://i.ytimg.com/vi/abc123XYZ_-/hqdefault.jpg',
    });
  });

  test('reports missing when the archive is absent for an older version', () => {
    expect(resolveThumbSource({ ...base, version: 1, fileExists: false })).toEqual({ kind: 'missing' });
  });

  test('unknown latest version: only version 1 may fall back to the CDN, never an older version', () => {
    expect(resolveThumbSource({ videoId: 'abc123XYZ_-', version: 1, latestVersion: null, fileExists: false })).toEqual({
      kind: 'redirect',
      url: ytCdnUrl('abc123XYZ_-'),
    });
    expect(resolveThumbSource({ videoId: 'abc123XYZ_-', version: 2, latestVersion: null, fileExists: false })).toEqual({ kind: 'missing' });
  });
});
