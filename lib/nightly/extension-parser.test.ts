// Unit tests for the Chrome extension's URL parser (chrome-extension/src/shared.js).
// The extension ships as bundled plain JS; these tests run against the source.
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '../../chrome-extension/src/shared.js'),
  'utf8'
);
// Extract just the parser function body (avoids executing imports/async siblings)
const fnMatch = src.match(/export function parseYouTubeUrl[\s\S]*?\n\}/);
if (!fnMatch) throw new Error('parseYouTubeUrl not found in shared.js');
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const parseYouTubeUrl = new Function(
  `${fnMatch[0].replace('export function', 'function')}
   return parseYouTubeUrl;`
)();

describe('extension URL parser', () => {
  it('parses watch URLs to video refs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'video',
      ref: 'dQw4w9WgXcQ',
    });
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abc&t=42s')?.ref).toBe('abc');
  });
  it('parses channel and handle URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ')).toEqual({
      kind: 'channel',
      ref: 'UCBJycsmduvYEL83R_U4JriQ',
    });
    expect(parseYouTubeUrl('https://www.youtube.com/@mkbhd/videos')).toEqual({
      kind: 'handle',
      ref: '@mkbhd',
    });
  });
  it('rejects non-YouTube and non-content URLs', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=x')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(parseYouTubeUrl('not a url')).toBeNull();
  });
});

describe('shipped extension artifacts are module-free', () => {
  it.each(['background.js', 'popup.js'])('%s has no import/export statements', (f) => {
    const bundled = fs.readFileSync(
      path.join(__dirname, '../../chrome-extension', f),
      'utf8'
    );
    expect(bundled).not.toMatch(/^\s*import\s/m);
    expect(bundled).not.toMatch(/^\s*export\s/m);
  });
  it('manifest does not require module service worker support', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../chrome-extension/manifest.json'), 'utf8')
    );
    expect(manifest.background.type).toBeUndefined();
    expect(manifest.background.service_worker).toBe('background.js');
  });
});
