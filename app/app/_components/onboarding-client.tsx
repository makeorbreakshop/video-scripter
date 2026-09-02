'use client';
// Two steps: your channel, then one competitor. Both use the same add-channel box;
// the only difference is the role the channel is tracked under.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import AddChannel from './add-channel';

export default function OnboardingClient({ initialTracked }: { initialTracked: { channel_id: string; role: string }[] }) {
  const router = useRouter();
  const [tracked, setTracked] = useState(initialTracked);
  const hasSelf = tracked.some((t) => t.role === 'self');
  const step: 1 | 2 = hasSelf ? 2 : 1;

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

      <h1 className="cs-h1">{step === 1 ? 'Add your channel' : 'Add one competitor'}</h1>
      <p className="cs-sub" style={{ marginBottom: 16 }}>
        {step === 1
          ? 'We use your channel to set the baseline every score is measured against.'
          : 'Pick the channel you measure yourself against. You can add more later.'}
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
        {step === 2 && <Link className="cs-btn" href="/app/feed">Skip for now</Link>}
        <span className="cs-hiscore">step {step} of 2</span>
      </div>
    </div>
  );
}
