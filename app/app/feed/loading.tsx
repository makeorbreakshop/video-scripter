// Instant shell for /app/feed. Mirrors page.tsx + feed-client.tsx: the page head, then the
// chip row and .cs-row items from components/app/skeletons.tsx — the same fallback the
// page's own Suspense boundary uses, at the row height the real events occupy.
import { FeedSkeleton, SkeletonStyles } from '@/components/app/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <SkeletonStyles />
      <div className="cs-page-head">
        <div>
          <div className="sk" style={{ width: 84, height: 20, borderRadius: 5 }} />
          <div className="sk" style={{ width: 340, maxWidth: '80vw', height: 13, borderRadius: 4, marginTop: 6 }} />
        </div>
      </div>
      <FeedSkeleton />
    </div>
  );
}
