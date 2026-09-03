import { classifyItem, classifyForInsert } from './classify';

const item = (duration: string | null | undefined, liveBroadcastContent?: string) => ({
  id: 'vid00000001',
  snippet: liveBroadcastContent === undefined ? {} : { liveBroadcastContent },
  contentDetails: duration === undefined ? {} : { duration },
});

describe('classifyItem', () => {
  it('calls anything 62s or less a short', () => {
    expect(classifyItem(item('PT1S'))).toBe('short');
    expect(classifyItem(item('PT58S'))).toBe('short');
    expect(classifyItem(item('PT1M2S'))).toBe('short'); // 62s, the classic boundary
  });

  it('calls 63..180s a clip that must be verified', () => {
    expect(classifyItem(item('PT1M3S'))).toBe('clip');   // 63s
    expect(classifyItem(item('PT2M'))).toBe('clip');
    expect(classifyItem(item('PT3M'))).toBe('clip');     // 180s, still a possible Short
  });

  it('calls anything over 180s longform', () => {
    expect(classifyItem(item('PT3M1S'))).toBe('longform'); // 181s
    expect(classifyItem(item('PT10M'))).toBe('longform');
    expect(classifyItem(item('PT1H'))).toBe('longform');
    expect(classifyItem(item('PT1H2M'))).toBe('longform');
    expect(classifyItem(item('P1DT2H'))).toBe('longform');
  });

  it('calls live and upcoming broadcasts live, whatever the duration says', () => {
    expect(classifyItem(item('PT10M', 'live'))).toBe('live');
    expect(classifyItem(item('PT10M', 'upcoming'))).toBe('live');
    expect(classifyItem(item('PT30S', 'live'))).toBe('live');
    expect(classifyItem(item(undefined, 'upcoming'))).toBe('live');
  });

  it('does not treat liveBroadcastContent "none" as live', () => {
    expect(classifyItem(item('PT1M3S', 'none'))).toBe('clip');
    expect(classifyItem(item('PT10M', 'none'))).toBe('longform');
  });

  it('calls a P0D or missing or unparsable duration live (a placeholder, never a show)', () => {
    expect(classifyItem(item('P0D'))).toBe('live');
    expect(classifyItem(item(undefined))).toBe('live');
    expect(classifyItem(item(null))).toBe('live');
    expect(classifyItem(item(''))).toBe('live');
    expect(classifyItem(item('banana'))).toBe('live');
    expect(classifyItem(item('PT'))).toBe('live');
  });

  it('survives a missing snippet / contentDetails entirely', () => {
    expect(classifyItem({ id: 'x' } as any)).toBe('live');
    expect(classifyItem({} as any)).toBe('live');
  });
});

describe('classifyForInsert', () => {
  const never = jest.fn(async () => { throw new Error('must not ask YouTube'); });

  it('never asks YouTube about a short, a longform video or a live placeholder', async () => {
    await expect(classifyForInsert(item('PT30S'), never))
      .resolves.toEqual({ kind: 'short', is_short: true, shorts_checked_at: null });
    await expect(classifyForInsert(item('PT10M'), never))
      .resolves.toEqual({ kind: 'longform', is_short: false, shorts_checked_at: null });
    await expect(classifyForInsert(item('P0D'), never))
      .resolves.toEqual({ kind: 'live', is_short: null, shorts_checked_at: null });
    expect(never).not.toHaveBeenCalled();
  });

  it('resolves a clip YouTube confirms is a Short', async () => {
    const ask = jest.fn(async () => true);
    await expect(classifyForInsert(item('PT2M'), ask))
      .resolves.toEqual({ kind: 'short', is_short: true, shorts_checked_at: 'now' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('vid00000001');
  });

  it('resolves a clip YouTube says is not a Short', async () => {
    const ask = jest.fn(async () => false);
    await expect(classifyForInsert(item('PT2M'), ask))
      .resolves.toEqual({ kind: 'longform', is_short: false, shorts_checked_at: 'now' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('leaves a clip unverified when YouTube cannot say, so longformSql keeps it out', async () => {
    const ask = jest.fn(async () => null);
    await expect(classifyForInsert(item('PT2M'), ask))
      .resolves.toEqual({ kind: 'clip', is_short: false, shorts_checked_at: null });
  });
});
