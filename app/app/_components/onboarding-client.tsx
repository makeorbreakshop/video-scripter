'use client';
// Two steps: your channel, then one competitor. Both use the same add-channel box;
// the only difference is the role the channel is tracked under. Neither is required —
// a user who only watches other people's channels skips step 1 and still gets a feed.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import AddChannel from './add-channel';

export default function OnboardingClient({ initialTracked }: { initialTracked: { channel_id: string; role: string }[] }) {
  const router = useRouter();
  const [tracked, setTracked] = useState(initialTracked);
  const [skippedSelf, setSkippedSelf] = useState(false);
  const hasSelf = tracked.some((t) => t.role === 'self');
  const step: 1 | 2 = hasSelf || skippedSelf ? 2 : 1;
  const hasAny = tracked.length > 0;

  async function added(channelId: string) {
    setTracked((t) => [...t, { channel_id: channelId, role: step === 1 ? 'self' : 'competitor' }]);
    if (step === 2) router.push('/app/feed');
    else router.refresh();
  }

  return (
    <div style={{ maxWidth: 520, margin: '32px auto' }}>
      <div className="cs-steps">
        <span className="cs-step" data-on={step === 1}>1 YOUR CHANNEL</span>
        <span className="cs-step" data-on={step === 2}>2 ONE COMPETITOR</span>
      </div>

      <h1 className="cs-h1">{step === 1 ? 'Add your channel' : 'Add a channel to watch'}</h1>
      <p className="cs-sub" style={{ marginBottom: 16 }}>
        {step === 1
          ? 'Optional — you can track other people’s channels without one of your own.'
          : 'Pick a channel you want to keep an eye on. You can add more later.'}
      </p>

      <AddChannel
        key={step}
        autoFocus
        trackedIds={tracked.map((t) => t.channel_id)}
        role={step === 1 ? 'self' : 'competitor'}
        onAdded={added}
        placeholder={step === 1 ? 'Your channel name, @handle or URL' : 'Their channel name, @handle or URL'}
      />

      <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
        {step === 1 ? (
          <button type="button" className="cs-btn" onClick={() => setSkippedSelf(true)}>
            I don’t have a channel, skip
          </button>
        ) : (
          <Link className="cs-btn" href={hasAny ? '/app/feed' : '/app/channels'}>
            {hasAny ? 'Skip for now' : 'Skip'}
          </Link>
        )}
        <span className="cs-hiscore">step {step} of 2</span>
      </div>
    </div>
  );
}
