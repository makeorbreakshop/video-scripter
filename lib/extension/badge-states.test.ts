/** @jest-environment jsdom */
import { classifyBadge, channelRefFromAnchor, normalizeChannelRef } from './badge-states';

describe('classifyBadge — the four levels', () => {
  it('video in corpus → tracked, regardless of channel', () => {
    expect(classifyBadge('tracked', false)!.text).toBe('✓ tracked');
    expect(classifyBadge('tracked', true)!.cls).toBe('ci-tracked');
  });

  it('video waiting in queue from an earlier capture → queued', () => {
    expect(classifyBadge('queued', true)!.text).toBe('⏳ queued');
  });

  it('fresh capture on a known channel → new video going to queue', () => {
    expect(classifyBadge('captured', true)!.text).toBe('◉ new → queued');
    expect(classifyBadge('captured', null)!.text).toBe('◉ new → queued'); // channel undetermined: don't overclaim
  });

  it('fresh capture on an unknown channel → new channel', () => {
    const spec = classifyBadge('captured', false)!;
    expect(spec.text).toBe('★ new channel');
    expect(spec.cls).toBe('ci-newchannel');
  });

  it('no status → no badge', () => {
    expect(classifyBadge(null, false)).toBeNull();
  });
});

describe('channelRefFromAnchor', () => {
  it('finds the @handle link inside the result host', () => {
    document.body.innerHTML = `
      <ytd-video-renderer>
        <ytd-thumbnail><a id="t" href="/watch?v=abc123defgh"><img></a></ytd-thumbnail>
        <a href="/@EthanChlebowski">Ethan Chlebowski</a>
      </ytd-video-renderer>`;
    expect(channelRefFromAnchor(document.getElementById('t')!)).toBe('@EthanChlebowski');
  });

  it('prefers a UC channel link when present', () => {
    document.body.innerHTML = `
      <yt-lockup-view-model>
        <a id="t" href="/watch?v=abc123defgh"></a>
        <div><img></div>
        <a href="/channel/UCvVsD2hFZRgKNH7x5Q1wwug">Chris Young</a>
      </yt-lockup-view-model>`;
    expect(channelRefFromAnchor(document.getElementById('t')!)).toBe('UCvVsD2hFZRgKNH7x5Q1wwug');
  });

  it('ignores watch/shorts links and returns null when no channel link exists', () => {
    document.body.innerHTML = `
      <ytd-video-renderer>
        <a id="t" href="/watch?v=abc123defgh"><img></a>
        <a href="/watch?v=abc123defgh">Title</a>
      </ytd-video-renderer>`;
    expect(channelRefFromAnchor(document.getElementById('t')!)).toBeNull();
  });
});

describe('normalizeChannelRef', () => {
  it('strips @ and lowercases so client and server agree', () => {
    expect(normalizeChannelRef('@EthanChlebowski')).toBe('ethanchlebowski');
    expect(normalizeChannelRef('UCvVsD2hFZRgKNH7x5Q1wwug')).toBe('ucvvsd2hfzrgknh7x5q1wwug');
  });
});
