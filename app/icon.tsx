import { ImageResponse } from 'next/og';
import { BRAND, MARK_CELLS, MARK_GRID } from '@/lib/app/brand';

// The app's favicon: the hammer in --cs-accent-on on an accent plate, which is the wordmark's
// construction at 32px. Every route under / inherits it; before this only /thumbnail-battle
// had an icon, so ChannelSmith showed the browser's blank default in the tab.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

const CELL = size.width / MARK_GRID;

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', position: 'relative',
        background: BRAND.accent, borderRadius: 6,
      }}>
        {MARK_CELLS.map(([x, y, w, h]) => (
          <div key={`${x}-${y}`} style={{
            position: 'absolute',
            left: x * CELL, top: y * CELL, width: w * CELL, height: h * CELL,
            background: BRAND.accentOn,
          }} />
        ))}
      </div>
    ),
    size,
  );
}
