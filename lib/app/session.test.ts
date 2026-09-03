jest.mock('@clerk/nextjs/server', () => ({ auth: jest.fn(), currentUser: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('../admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
jest.mock('./users', () => ({ ensureUser: jest.fn(), userByClerkId: jest.fn() }));

import { auth, currentUser } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { one } from '../admin/db';
import { ensureUser, userByClerkId } from './users';
import { requireAppUser } from './session';

const mAuth = auth as unknown as jest.Mock;
const mCurrentUser = currentUser as jest.Mock;

// auth() carries the clerk_id off the locally-verified session JWT; signedIn(null) is a visitor.
const signedIn = (userId: string | null) => mAuth.mockResolvedValue({ userId });
const mCookies = cookies as jest.Mock;
const mOne = one as jest.Mock;
const mEnsure = ensureUser as jest.Mock;
const mByClerkId = userByClerkId as jest.Mock;

const PROD = { id: 'uuid-prod', clerk_id: 'user_live', email: 'a@b.c', plan: 'owner', created_at: '2026-09-02' };
const DEV = { id: 'uuid-dev', clerk_id: 'user_test', email: 'a@b.c', plan: 'owner', created_at: '2026-09-02' };

// NODE_ENV is typed readonly, so set it through a writable view of process.env.
const setNodeEnv = (v: string) => { (process.env as Record<string, string>).NODE_ENV = v; };
const env = { ...process.env };
beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...env };
  delete process.env.CS_DEV_AS_CLERK_ID;
  delete process.env.CS_PREVIEW_TOKEN;
  delete process.env.CS_PREVIEW_CLERK_ID;
  delete process.env.CS_PREVIEW_EMAIL;
  setNodeEnv('development');
  mCookies.mockResolvedValue({ get: () => undefined });
  signedIn(null);
});
afterAll(() => { process.env = env; });

describe('requireAppUser: normal Clerk path', () => {
  it('reads the existing row by clerk_id without touching Clerk\'s backend', async () => {
    signedIn('user_test');
    mByClerkId.mockResolvedValue(DEV);
    await expect(requireAppUser()).resolves.toBe(DEV);
    expect(mByClerkId).toHaveBeenCalledWith('user_test');
    // The whole point of auth(): no currentUser() round trip on the common path.
    expect(mCurrentUser).not.toHaveBeenCalled();
    expect(mEnsure).not.toHaveBeenCalled();
  });

  it('falls back to currentUser and inserts when there is no row yet', async () => {
    signedIn('user_test');
    mByClerkId.mockResolvedValue(null);
    mCurrentUser.mockResolvedValue({ id: 'user_test', primaryEmailAddress: { emailAddress: 'a@b.c' }, emailAddresses: [] });
    mEnsure.mockResolvedValue(DEV);
    await expect(requireAppUser()).resolves.toBe(DEV);
    expect(mEnsure.mock.calls[0][0]).toMatchObject({ id: 'user_test', primaryEmailAddress: { emailAddress: 'a@b.c' } });
  });

  it('returns null when nobody is signed in', async () => {
    signedIn(null);
    await expect(requireAppUser()).resolves.toBeNull();
    expect(mCurrentUser).not.toHaveBeenCalled();
    expect(mEnsure).not.toHaveBeenCalled();
  });

  it('returns null when the session is valid but Clerk has no profile for it', async () => {
    signedIn('user_test');
    mByClerkId.mockResolvedValue(null);
    mCurrentUser.mockResolvedValue(null);
    await expect(requireAppUser()).resolves.toBeNull();
    expect(mEnsure).not.toHaveBeenCalled();
  });
});

describe('requireAppUser: CS_DEV_AS_CLERK_ID', () => {
  it('resolves to the named row instead of the signed-in one', async () => {
    process.env.CS_DEV_AS_CLERK_ID = 'user_live';
    mByClerkId.mockResolvedValue(PROD);
    await expect(requireAppUser()).resolves.toBe(PROD);
    expect(mByClerkId).toHaveBeenCalledWith('user_live');
    expect(mAuth).not.toHaveBeenCalled();
    expect(mCurrentUser).not.toHaveBeenCalled();
    expect(mEnsure).not.toHaveBeenCalled();
  });

  it('is ignored in production', async () => {
    setNodeEnv('production');
    process.env.CS_DEV_AS_CLERK_ID = 'user_live';
    signedIn('user_test');
    mByClerkId.mockResolvedValue(DEV);
    await expect(requireAppUser()).resolves.toBe(DEV);
    // It resolved the signed-in id, never the CS_DEV_AS_CLERK_ID one.
    expect(mByClerkId).toHaveBeenCalledTimes(1);
    expect(mByClerkId).toHaveBeenCalledWith('user_test');
  });

  it('throws rather than silently falling back when the row is missing', async () => {
    process.env.CS_DEV_AS_CLERK_ID = 'user_gone';
    mByClerkId.mockResolvedValue(null);
    await expect(requireAppUser()).rejects.toThrow('user_gone');
    expect(mEnsure).not.toHaveBeenCalled();
  });

  it('takes precedence over the preview cookie', async () => {
    process.env.CS_DEV_AS_CLERK_ID = 'user_live';
    process.env.CS_PREVIEW_TOKEN = 'tok';
    process.env.CS_PREVIEW_CLERK_ID = 'user_test';
    mCookies.mockResolvedValue({ get: () => ({ value: 'tok' }) });
    mByClerkId.mockResolvedValue(PROD);
    await expect(requireAppUser()).resolves.toBe(PROD);
    expect(mByClerkId).toHaveBeenCalledWith('user_live');
  });
});

describe('requireAppUser: preview cookie', () => {
  beforeEach(() => {
    process.env.CS_PREVIEW_TOKEN = 'tok';
    mCookies.mockResolvedValue({ get: () => ({ value: 'tok' }) });
  });

  it('pins to CS_PREVIEW_CLERK_ID when set', async () => {
    process.env.CS_PREVIEW_CLERK_ID = 'user_live';
    mByClerkId.mockResolvedValue(PROD);
    await expect(requireAppUser()).resolves.toBe(PROD);
    expect(mByClerkId).toHaveBeenCalledWith('user_live');
    expect(mOne).not.toHaveBeenCalled();
  });

  it('breaks the email tie deterministically when it has to fall back', async () => {
    process.env.CS_PREVIEW_EMAIL = 'a@b.c';
    mOne.mockResolvedValue(PROD);
    await expect(requireAppUser()).resolves.toBe(PROD);
    const [sql, params] = mOne.mock.calls[0];
    // email alone is not unique across Clerk instances, so the order must be total.
    expect(sql).toContain("order by plan = 'owner' desc, created_at asc, id asc");
    expect(params).toEqual(['a@b.c']);
  });

  it('is ignored when the cookie does not match the token', async () => {
    process.env.CS_PREVIEW_CLERK_ID = 'user_live';
    mCookies.mockResolvedValue({ get: () => ({ value: 'wrong' }) });
    signedIn('user_test');
    mByClerkId.mockResolvedValue(DEV);
    await expect(requireAppUser()).resolves.toBe(DEV);
    expect(mByClerkId).toHaveBeenCalledTimes(1);
    expect(mByClerkId).toHaveBeenCalledWith('user_test');
  });

  it('is ignored in production', async () => {
    setNodeEnv('production');
    process.env.CS_PREVIEW_CLERK_ID = 'user_live';
    signedIn('user_test');
    mByClerkId.mockResolvedValue(DEV);
    await expect(requireAppUser()).resolves.toBe(DEV);
    expect(mByClerkId).toHaveBeenCalledTimes(1);
    expect(mByClerkId).toHaveBeenCalledWith('user_test');
  });
});
