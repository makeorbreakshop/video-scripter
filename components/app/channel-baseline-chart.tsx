'use client';

// The Analytics tab's chart, behind the same next/dynamic plate the video page uses: recharts
// is ~1 MB and this tab is the third one, so it never enters the channel page's first bundle.
import dynamic from 'next/dynamic';
import type { BaselinePoint } from '@/lib/app/baseline-series';

const HEIGHT = 340;

const ChannelBaselinePlot = dynamic(() => import('./channel-baseline-plot'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      style={{
        height: HEIGHT, borderRadius: 'var(--cs-radius)',
        border: '1px solid var(--cs-line)', background: 'var(--cs-surface-2)',
      }}
    />
  ),
});

export function ChannelBaselineChart({ points }: { points: BaselinePoint[] }) {
  return (
    <div style={{ minHeight: HEIGHT }}>
      <ChannelBaselinePlot points={points} />
    </div>
  );
}
