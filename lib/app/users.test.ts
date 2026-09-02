jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
import { q, one } from '../admin/db';
import { ensureUser, userPlan, planUsage, clerkEmail } from './users';

const mq = q as jest.Mock;
const mone = one as jest.Mock;
beforeEach(() => { mq.mockReset(); mone.mockReset(); });

describe('clerkEmail', () => {
  it('prefers the primary address, falls back to the first, then null', () => {
    expect(clerkEmail({ id: 'u', primaryEmailAddress: { emailAddress: 'a@b.c' } })).toBe('a@b.c');
    expect(clerkEmail({ id: 'u', emailAddresses: [{ emailAddress: 'x@y.z' }] })).toBe('x@y.z');
    expect(clerkEmail({ id: 'u' })).toBeNull();
    expect(clerkEmail({ id: 'u', emailAddresses: [] })).toBeNull();
  });
});

describe('ensureUser', () => {
  it('upserts by clerk_id and returns the row', async () => {
    mq.mockResolvedValue([{ id: 'uuid-1', clerk_id: 'user_1', email: 'a@b.c', plan: 'free' }]);
    const u = await ensureUser({ id: 'user_1', primaryEmailAddress: { emailAddress: 'a@b.c' } });
    expect(u.id).toBe('uuid-1');
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toContain('on conflict (clerk_id) do update');
    expect(params).toEqual(['user_1', 'a@b.c']);
  });

  it('never overwrites a stored email with null', async () => {
    mq.mockResolvedValue([{ id: 'uuid-1' }]);
    await ensureUser({ id: 'user_1' });
    expect(mq.mock.calls[0][0]).toContain('coalesce(excluded.email, app_users.email)');
    expect(mq.mock.calls[0][1]).toEqual(['user_1', null]);
  });

  it('rejects a missing clerk id', async () => {
    await expect(ensureUser({ id: '' } as any)).rejects.toThrow('missing clerk id');
    expect(mq).not.toHaveBeenCalled();
  });
});

describe('userPlan', () => {
  it('returns the stored plan', async () => {
    mone.mockResolvedValue({ plan: 'pro' });
    await expect(userPlan('uuid-1')).resolves.toBe('pro');
  });
  it('defaults unknown plans and missing users to free', async () => {
    mone.mockResolvedValue({ plan: 'legacy' });
    await expect(userPlan('uuid-1')).resolves.toBe('free');
    mone.mockResolvedValue(null);
    await expect(userPlan('nobody')).resolves.toBe('free');
  });
});

describe('planUsage', () => {
  it('returns plan, limits and current counts', async () => {
    mone.mockResolvedValue({ plan: 'pro', tracked: '7', watched: '2' });
    await expect(planUsage('uuid-1')).resolves.toEqual({
      plan: 'pro', limits: { tracked: 25, watchedClosely: 10 }, tracked: 7, watchedClosely: 2,
    });
  });
  it('treats a missing user as a free user with nothing tracked', async () => {
    mone.mockResolvedValue(null);
    await expect(planUsage('nobody')).resolves.toEqual({
      plan: 'free', limits: { tracked: 2, watchedClosely: 1 }, tracked: 0, watchedClosely: 0,
    });
  });
});
