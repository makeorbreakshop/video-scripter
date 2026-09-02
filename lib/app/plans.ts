// Plan limits for ChannelSmith. Free is the friend-tester tier from the MVP
// plan (self + one competitor); pro is the proposed $19/mo tier.
export type PlanName = 'free' | 'pro';

export interface PlanLimits {
  tracked: number;        // total channels in user_channels
  watchedClosely: number; // dense-sampling slots
}

export const PLANS: Record<PlanName, PlanLimits> = {
  free: { tracked: 2, watchedClosely: 1 },
  pro: { tracked: 25, watchedClosely: 10 },
};

/** Unknown/missing plan names fall back to free — never to the generous tier. */
export function planLimits(plan: string | null | undefined): PlanLimits {
  const key = (plan || '').toLowerCase();
  return PLANS[key as PlanName] ?? PLANS.free;
}

export function normalizePlan(plan: string | null | undefined): PlanName {
  const key = (plan || '').toLowerCase();
  return (key in PLANS ? key : 'free') as PlanName;
}

export interface LimitCheck {
  ok: boolean;
  reason?: string;
}

/** Can this user add one more tracked channel? `current` excludes the new one. */
export function canTrackMore(plan: string | null | undefined, current: number): LimitCheck {
  const { tracked } = planLimits(plan);
  if (current >= tracked) {
    return {
      ok: false,
      reason: `Your ${normalizePlan(plan)} plan tracks ${tracked} channel${tracked === 1 ? '' : 's'}. Upgrade to track more.`,
    };
  }
  return { ok: true };
}

/** Can this user mark one more channel as watched closely? */
export function canWatchMoreClosely(plan: string | null | undefined, current: number): LimitCheck {
  const { watchedClosely } = planLimits(plan);
  if (current >= watchedClosely) {
    return {
      ok: false,
      reason: `Your ${normalizePlan(plan)} plan allows ${watchedClosely} closely watched channel${watchedClosely === 1 ? '' : 's'}. Upgrade for more.`,
    };
  }
  return { ok: true };
}
