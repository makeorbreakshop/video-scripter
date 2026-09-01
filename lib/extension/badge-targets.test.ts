/** @jest-environment jsdom */
// Fixtures mirror real YouTube DOM sampled 2026-09-01:
// - classic search results: ytd-video-renderer, the /watch anchor CONTAINS the img
// - new lockup results: yt-lockup-view-model, the /watch anchor does NOT contain
//   the img; the img lives in a sibling yt-thumbnail-view-model whose own anchor
//   has an empty or non-watch href.
import { findBadgeTargets, videoIdFromHref } from './badge-targets';

function dom(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const CLASSIC = `
<ytd-video-renderer>
  <ytd-thumbnail>
    <a id="thumbnail" href="/watch?v=classic01234">
      <yt-image><img src="thumb.jpg"></yt-image>
    </a>
  </ytd-thumbnail>
  <a id="video-title" href="/watch?v=classic01234">Title</a>
</ytd-video-renderer>`;

const LOCKUP = `
<yt-lockup-view-model>
  <div class="yt-lockup-view-model-wiz__content-image">
    <yt-thumbnail-view-model>
      <a href="">
        <div><img src="thumb.jpg"></div>
      </a>
    </yt-thumbnail-view-model>
  </div>
  <div class="yt-lockup-metadata-view-model-wiz">
    <a class="yt-lockup-metadata-view-model-wiz__title" href="/watch?v=lockup012345&pp=xyz">Title</a>
  </div>
</yt-lockup-view-model>`;

describe('videoIdFromHref', () => {
  it('extracts the id including with pp params', () => {
    expect(videoIdFromHref('/watch?v=abc123DEF-_&pp=ygUO')).toBe('abc123DEF-_');
    expect(videoIdFromHref('/playlist?list=x')).toBeNull();
  });
});

describe('findBadgeTargets', () => {
  it('finds classic ytd-video-renderer results and anchors the badge near the img', () => {
    const targets = findBadgeTargets(dom(CLASSIC));
    expect(targets.map((t) => t.id)).toEqual(['classic01234']);
    expect(targets[0].container.querySelector('img')).not.toBeNull();
  });

  it('finds new lockup results where the watch anchor does not contain the img', () => {
    const targets = findBadgeTargets(dom(LOCKUP));
    expect(targets.map((t) => t.id)).toEqual(['lockup012345']);
    // badge must land on the thumbnail, not the title link
    expect(targets[0].container.querySelector('img') ?? targets[0].container.closest('img')).not.toBeNull();
  });

  it('dedupes multiple anchors for the same video', () => {
    const targets = findBadgeTargets(dom(CLASSIC + CLASSIC.replace(/classic01234/g, 'classic01234')));
    expect(targets.filter((t) => t.id === 'classic01234')).toHaveLength(1);
  });

  it('ignores shorts and non-watch links', () => {
    const targets = findBadgeTargets(
      dom(`<a href="/shorts/abcdefghijk"><img src="t.jpg"></a>`)
    );
    expect(targets).toHaveLength(0);
  });
});
