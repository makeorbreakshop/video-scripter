/** @jest-environment jsdom */
import { cleanHint, hintForAnchor } from './feed-hint';

describe('cleanHint', () => {
  it('rejects duration stamps and player chrome', () => {
    expect(cleanHint('7:29 7:29 Now playing')).toBe('');
    expect(cleanHint('27:45')).toBe('');
    expect(cleanHint('LIVE')).toBe('');
    expect(cleanHint('Now playing')).toBe('');
    expect(cleanHint('')).toBe('');
  });

  it('strips our own badge text', () => {
    expect(cleanHint('✓ tracked 23:41 Real Title Here')).toBe('Real Title Here');
  });

  it('strips leading duration stamps but keeps the title', () => {
    expect(cleanHint('9:09 9:09 Now playing 5:30 How to Sharpen Knives')).toBe(
      'Now playing 5:30 How to Sharpen Knives'.replace(/^Now playing 5:30 /, 'Now playing 5:30 ')
    );
  });

  it('keeps real titles containing numbers', () => {
    expect(cleanHint('50 Cooking Tips With Gordon Ramsay')).toBe(
      '50 Cooking Tips With Gordon Ramsay'
    );
  });
});

describe('hintForAnchor', () => {
  it('prefers the host title over thumbnail overlay text', () => {
    document.body.innerHTML = `
      <ytd-video-renderer>
        <ytd-thumbnail>
          <a id="thumb" href="/watch?v=abc123defgh">
            <img src="t.jpg"><span class="ci-badge ci-tracked">✓ tracked</span>
            <span>7:29</span><span>Now playing</span>
          </a>
        </ytd-thumbnail>
        <a id="video-title" title="The Lazy Way to Master the Air Fryer" href="/watch?v=abc123defgh">The Lazy Way to Master the Air Fryer</a>
      </ytd-video-renderer>`;
    const thumb = document.getElementById('thumb')!;
    expect(hintForAnchor(thumb)).toBe('The Lazy Way to Master the Air Fryer');
  });

  it('uses aria-label when present', () => {
    document.body.innerHTML = `<a id="a" aria-label="Beginner's guide to Kitchen Organization" href="/watch?v=abc123defgh"><img></a>`;
    expect(hintForAnchor(document.getElementById('a')!)).toBe(
      "Beginner's guide to Kitchen Organization"
    );
  });

  it('returns empty rather than junk when nothing usable exists', () => {
    document.body.innerHTML = `<a id="a" href="/watch?v=abc123defgh"><span>16:18</span></a>`;
    expect(hintForAnchor(document.getElementById('a')!)).toBe('');
  });
});
