// Instant shell for /app/channels/[id]. Mirrors page.tsx: head (avatar + title + track
// button), then the filter bar and three-across 16:9 grid — the same components the page's
// own Suspense boundary falls back to (components/app/skeletons.tsx), so the boxes are at the
// same sizes and nothing shifts when the real render lands.
import { ChannelHeadSkeleton, GridSkeleton } from '@/components/app/skeletons';

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <ChannelHeadSkeleton />
      <GridSkeleton />
    </div>
  );
}
