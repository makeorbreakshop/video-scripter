// Instant shell for /app/channels. Mirrors channel-list.tsx lane for lane: the import button
// and the notify meter on one line, the 44px search box, the chips row, then the list card
// from components/app/skeletons.tsx — the same fallback the page's own Suspense boundary
// uses, so nothing moves when the rows land.
import { ChannelListSkeleton, SkeletonStyles } from '@/components/app/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="cs-chan-body">
      <SkeletonStyles />
      <div className="cs-page-head cs-chan-head">
        <div className="sk" style={{ width: 186, height: 36, borderRadius: 8 }} />
        <div style={{ textAlign: 'right' }}>
          <div className="sk" style={{ width: 96, height: 10, borderRadius: 3, marginLeft: 'auto' }} />
          <div className="sk" style={{ width: 230, height: 10, borderRadius: 2, marginTop: 6, marginLeft: 'auto' }} />
        </div>
      </div>

      <div className="sk" style={{ width: '100%', height: 44, borderRadius: 10 }} />

      <div className="cs-gchips">
        <div className="cs-chips">
          {[64, 88, 96, 84].map((w, i) => (
            <div key={i} className="sk" style={{ width: w, height: 30, borderRadius: 15, flex: 'none' }} />
          ))}
        </div>
      </div>

      <ChannelListSkeleton />
    </div>
  );
}
