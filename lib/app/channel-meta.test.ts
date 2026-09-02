import { pickAvatar, metaFromListItem } from './channel-meta';

describe('pickAvatar', () => {
  it('prefers high, then medium, then default', () => {
    expect(pickAvatar({ high: { url: 'h' }, medium: { url: 'm' }, default: { url: 'd' } })).toBe('h');
    expect(pickAvatar({ medium: { url: 'm' }, default: { url: 'd' } })).toBe('m');
    expect(pickAvatar({ default: { url: 'd' } })).toBe('d');
  });
  it('is null when there is nothing usable', () => {
    expect(pickAvatar(undefined)).toBeNull();
    expect(pickAvatar({})).toBeNull();
    expect(pickAvatar({ high: { url: undefined } })).toBeNull();
  });
});

describe('metaFromListItem', () => {
  it('maps a channels.list item', () => {
    expect(
      metaFromListItem({
        id: 'UC1',
        snippet: { title: 'Wittworks', thumbnails: { high: { url: 'https://x/a.jpg' } } },
        statistics: { subscriberCount: '12345', videoCount: '62' },
      })
    ).toEqual({
      channel_id: 'UC1',
      title: 'Wittworks',
      avatar_url: 'https://x/a.jpg',
      subscriber_count: 12345,
      video_count: 62,
    });
  });

  it('tolerates missing statistics and snippet', () => {
    expect(metaFromListItem({ id: 'UC2' })).toEqual({
      channel_id: 'UC2', title: null, avatar_url: null, subscriber_count: null, video_count: null,
    });
  });

  it('is null without an id', () => {
    expect(metaFromListItem({ snippet: { title: 'x' } })).toBeNull();
    expect(metaFromListItem(null)).toBeNull();
  });
});
