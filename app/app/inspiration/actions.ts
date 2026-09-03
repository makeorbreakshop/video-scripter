'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { parseInspirationFeedback } from '@/lib/app/inspiration-feedback-core';
import { setInspirationFeedback } from '@/lib/app/inspiration';

export async function updateInspirationFeedback(formData: FormData): Promise<void> {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  const input = parseInspirationFeedback(Object.fromEntries(formData.entries()));
  await setInspirationFeedback(user.id, input);
  revalidatePath('/app/inspiration');
}
