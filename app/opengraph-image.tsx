import { ImageResponse } from 'next/og';
import { BRAND, MARK_CELLS, MARK_GRID } from '@/lib/app/brand';

// The card a shared ChannelSmith link previews as. Same two elements as the app header — the
// mark and the name on the brand green — so a link and the product look like one thing.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND.name} — ${BRAND.tagline}`;

const MARK_PX = 168;
const CELL = MARK_PX / MARK_GRID;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: 34, padding: 88,
        background: BRAND.groundDark, color: BRAND.accentOn,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}>
        <div style={{
          display: 'flex', position: 'relative',
          width: MARK_PX, height: MARK_PX, background: BRAND.accent, borderRadius: 24,
        }}>
          {MARK_CELLS.map(([x, y, w, h]) => (
            <div key={`${x}-${y}`} style={{
              position: 'absolute',
              left: x * CELL, top: y * CELL, width: w * CELL, height: h * CELL,
              background: BRAND.accentOn,
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>
          {BRAND.name}
        </div>
        <div style={{ display: 'flex', fontSize: 36, lineHeight: 1.35, color: '#99A2B3', maxWidth: 860 }}>
          {BRAND.tagline}
        </div>
      </div>
    ),
    size,
  );
}
