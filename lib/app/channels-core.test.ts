import { parseChannelInput, bareHandle, uploadsPlaylistId } from './channels-core';

const CH = 'UC4tAgeVdaNB5vD_mBoxg50w'; // Allrecipes
const VID = 'dQw4w9WgXcQ';

describe('parseChannelInput — channel ids', () => {
  it('reads a bare UC id', () => {
    expect(parseChannelInput(CH)).toEqual({ kind: 'id', value: CH });
  });
  it('reads /channel/UC… in every URL shape', () => {
    for (const u of [
      `https://www.youtube.com/channel/${CH}`,
      `http://youtube.com/channel/${CH}`,
      `youtube.com/channel/${CH}`,
      `https://m.youtube.com/channel/${CH}/videos`,
      `https://www.youtube.com/channel/${CH}?view=0`,
    ]) {
      expect(parseChannelInput(u)).toEqual({ kind: 'id', value: CH });
    }
  });
  it('does not treat a malformed UC path as an id', () => {
    expect(parseChannelInput('https://youtube.com/channel/UCnope').kind).toBe('search');
  });
});

describe('parseChannelInput — handles', () => {
  it('reads a bare @handle', () => {
    expect(parseChannelInput('@allrecipes')).toEqual({ kind: 'handle', value: '@allrecipes' });
    expect(parseChannelInput('  @Make.or_Break-Shop ')).toEqual({ kind: 'handle', value: '@Make.or_Break-Shop' });
  });
  it('reads /@handle URLs, ignoring trailing paths and query', () => {
    expect(parseChannelInput('https://www.youtube.com/@allrecipes')).toEqual({ kind: 'handle', value: '@allrecipes' });
    expect(parseChannelInput('youtube.com/@allrecipes/videos')).toEqual({ kind: 'handle', value: '@allrecipes' });
    expect(parseChannelInput('https://youtube.com/@allrecipes?si=x')).toEqual({ kind: 'handle', value: '@allrecipes' });
  });
  it('maps legacy /c/ and /user/ vanity paths to a handle lookup', () => {
    expect(parseChannelInput('https://www.youtube.com/c/allrecipes')).toEqual({ kind: 'handle', value: '@allrecipes' });
    expect(parseChannelInput('https://www.youtube.com/user/allrecipes')).toEqual({ kind: 'handle', value: '@allrecipes' });
  });
  it('rejects handles that are too short to be real', () => {
    expect(parseChannelInput('@ab').kind).toBe('search');
  });
});

describe('parseChannelInput — videos', () => {
  it('reads watch URLs', () => {
    expect(parseChannelInput(`https://www.youtube.com/watch?v=${VID}`)).toEqual({ kind: 'video', value: VID });
    expect(parseChannelInput(`https://www.youtube.com/watch?v=${VID}&t=42s`)).toEqual({ kind: 'video', value: VID });
  });
  it('reads short links, shorts, live and embed URLs', () => {
    expect(parseChannelInput(`https://youtu.be/${VID}`)).toEqual({ kind: 'video', value: VID });
    expect(parseChannelInput(`https://youtu.be/${VID}?t=10`)).toEqual({ kind: 'video', value: VID });
    expect(parseChannelInput(`https://www.youtube.com/shorts/${VID}`)).toEqual({ kind: 'video', value: VID });
    expect(parseChannelInput(`https://www.youtube.com/live/${VID}`)).toEqual({ kind: 'video', value: VID });
    expect(parseChannelInput(`https://www.youtube.com/embed/${VID}`)).toEqual({ kind: 'video', value: VID });
  });
  it('does not mistake a bare 11-char word for a video id', () => {
    expect(parseChannelInput('woodworking')).toEqual({ kind: 'search', value: 'woodworking' });
  });
});

describe('parseChannelInput — free text and junk', () => {
  it('falls back to search', () => {
    for (const t of ['Make or Break Shop', 'allrecipes', 'https://example.com/@allrecipes', 'https://youtube.com/']) {
      expect(parseChannelInput(t).kind).toBe('search');
    }
  });
  it('handles empty input', () => {
    expect(parseChannelInput('')).toEqual({ kind: 'search', value: '' });
    expect(parseChannelInput('   ')).toEqual({ kind: 'search', value: '' });
  });
  it('never throws on hostile input', () => {
    for (const t of ['http://', '://', '@@@', 'youtube.com/channel/', '%%%']) {
      expect(() => parseChannelInput(t)).not.toThrow();
    }
  });
});

describe('helpers', () => {
  it('strips the @ for the API', () => {
    expect(bareHandle('@allrecipes')).toBe('allrecipes');
    expect(bareHandle('allrecipes')).toBe('allrecipes');
  });
  it('derives the uploads playlist id', () => {
    expect(uploadsPlaylistId(CH)).toBe('UU4tAgeVdaNB5vD_mBoxg50w');
    expect(() => uploadsPlaylistId('nope')).toThrow();
  });
});
