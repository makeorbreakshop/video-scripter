import { canSeeInspiration } from './flags';

describe('canSeeInspiration', () => {
  const env = { INSPIRATION_USERS: 'Tester@Example.com, other@example.com' } as unknown as NodeJS.ProcessEnv;

  it('always lets the owner plan in', () => {
    expect(canSeeInspiration({ email: 'anyone@example.com', plan: 'owner' }, env)).toBe(true);
  });
  it("always lets Brandon's address in, whatever the plan", () => {
    expect(canSeeInspiration({ email: 'brandon@makeorbreakshop.com', plan: 'free' }, env)).toBe(true);
  });
  it('honours the env allowlist, case-insensitively', () => {
    expect(canSeeInspiration({ email: 'tester@example.com', plan: 'pro' }, env)).toBe(true);
    expect(canSeeInspiration({ email: 'OTHER@example.com', plan: 'pro' }, env)).toBe(true);
  });
  it('hides it from everyone else, and from no user', () => {
    expect(canSeeInspiration({ email: 'someone@example.com', plan: 'pro' }, env)).toBe(false);
    expect(canSeeInspiration(null, env)).toBe(false);
    expect(canSeeInspiration({ email: null, plan: 'pro' }, {} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
