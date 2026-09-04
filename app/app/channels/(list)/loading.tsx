// Instant shell for /app/channels. Mirrors channel-list.tsx: page head with the plan
// readout, the search box, then the channel list from components/app/skeletons.tsx —
// the same fallback the page's own Suspense boundary uses, so nothing moves.
import { ChannelCardsSkeleton, SkeletonStyles } from '@/components/app/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <div className="cs-page-head">
        <div className="sk" style={{ width: 120, height: 20, borderRadius: 5 }} />
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="sk" style={{ width: 96, height: 12, borderRadius: 4, marginLeft: 'auto' }} />
          <div className="sk" style={{ width: 80, height: 13, borderRadius: 4, marginTop: 6, marginLeft: 'auto' }} />
        </div>
      </div>

      <div className="cs-section">
        <div className="sk" style={{ width: '100%', height: 40, borderRadius: 8 }} />
      </div>

      <ChannelCardsSkeleton />
    </div>
  );
}
