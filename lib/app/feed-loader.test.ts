jest.mock('../admin/db', () => ({ one: jest.fn(), q: jest.fn() }));
import { one } from '../admin/db';
import { feedShell, resolveSelection, avatarChannelIds, type FeedShell } from './feed-loader';

const shell = (over: Partial<FeedShell> = {}): FeedShell => ({
  tracked: [{ channel_id: 'a', name: 'A' }, { channel_id: 'b', name: 'B' }, { channel_id: 'c', name: null }],
  groups: [{ id: 'g1', name: 'Makers', color: 'blue', position: 0, created_at: '2026-01-01' }],
  memberships: { a: ['g1'], b: ['g1'] },
  ...over,
});

describe('feedShell', () => {
  beforeEach(() => (one as jest.Mock).mockReset());

  it('reads tracked, groups and memberships in one round trip', async () => {
    (one as jest.Mock).mockResolvedValue({
      tracked: [{ channel_id: 'a', name: 'A' }],
      groups: [{ id: 'g1', name: 'Makers', color: 'blue', position: 0, created_at: '2026-01-01' }],
      members: [{ channel_id: 'a', group_id: 'g1' }],
    });
    const s = await feedShell('u1');
    expect((one as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((one as jest.Mock).mock.calls[0][1]).toEqual(['u1']);
    expect(s.tracked).toHaveLength(1);
    expect(s.memberships).toEqual({ a: ['g1'] });
  });

  it('is empty rather than broken when the user has nothing', async () => {
    (one as jest.Mock).mockResolvedValue({ tracked: [], groups: [], members: [] });
    await expect(feedShell('u1')).resolves.toEqual({ tracked: [], groups: [], memberships: {} });
  });

  it('survives a null row', async () => {
    (one as jest.Mock).mockResolvedValue(null);
    await expect(feedShell('u1')).resolves.toEqual({ tracked: [], groups: [], memberships: {} });
  });

  it('collects several groups per channel', async () => {
    (one as jest.Mock).mockResolvedValue({
      tracked: [], groups: [],
      members: [{ channel_id: 'a', group_id: 'g1' }, { channel_id: 'a', group_id: 'g2' }],
    });
    expect((await feedShell('u1')).memberships).toEqual({ a: ['g1', 'g2'] });
  });
});

describe('resolveSelection', () => {
  it('defaults to every tracked channel', () => {
    expect(resolveSelection(undefined, shell())).toEqual({
      channelIds: ['a', 'b', 'c'], selected: null, channelId: null,
    });
  });

  it('narrows to one tracked channel', () => {
    expect(resolveSelection('b', shell())).toEqual({ channelIds: ['b'], selected: 'b', channelId: 'b' });
  });

  it('narrows to a group', () => {
    expect(resolveSelection('group:g1', shell())).toEqual({
      channelIds: ['a', 'b'], selected: 'group:g1', channelId: null,
    });
  });

  it('takes the first value when the parameter repeats', () => {
    expect(resolveSelection(['b', 'a'], shell()).channelIds).toEqual(['b']);
  });

  it('falls back to everything for a channel the user no longer tracks', () => {
    expect(resolveSelection('gone', shell()).channelIds).toEqual(['a', 'b', 'c']);
  });

  it('falls back to everything for a group that no longer exists', () => {
    expect(resolveSelection('group:gone', shell())).toEqual({
      channelIds: ['a', 'b', 'c'], selected: null, channelId: null,
    });
  });

  it('never hands the query an empty channel set for an empty group', () => {
    const s = shell({ memberships: {} });
    const r = resolveSelection('group:g1', s);
    expect(r.channelIds).toEqual(['a', 'b', 'c']);
    expect(r.selected).toBe('group:g1');
  });

  it('does not read a group id as a channel id', () => {
    const s = shell({ groups: [] });
    expect(resolveSelection('group:g1', s).channelIds).toEqual(['a', 'b', 'c']);
  });
});

describe('avatarChannelIds', () => {
  it('is the page\'s channels, deduped — not the whole tracked set', () => {
    const events = [
      { channel_id: 'a' }, { channel_id: 'a' }, { channel_id: 'b' }, { channel_id: null },
    ] as any;
    expect(avatarChannelIds(events)).toEqual(['a', 'b']);
  });

  it('is empty for an empty page', () => {
    expect(avatarChannelIds([])).toEqual([]);
    expect(avatarChannelIds(undefined as any)).toEqual([]);
  });
});
