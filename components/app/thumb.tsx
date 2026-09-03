// A thumbnail that fails quietly, without hydrating.
//
// This used to be a client component with an onError handler, which meant a channel page with
// sixty tiles shipped sixty React islands for what is, in the common case, a plain <img> that
// loads. The failure handling now lives in one delegated listener per document
// (thumb-runtime.ts, installed by <ThumbFallbackScript /> or by importing the runtime from a
// client component), so this file renders markup and nothing else.
//
// Sizing: hqdefault is 480x270, and the width/height attributes are what let the browser
// reserve the box before the bytes arrive. The .cs-thumb CSS box (aspect-ratio 16/9) still
// owns the layout — these only prevent the unsized-image reflow and satisfy lazy loading.

import { installThumbFallback } from './thumb-runtime';

const RUNTIME = `(${installThumbFallback.toString()})()`;

/** Emit once per page, above the first thumbnail. Idempotent if it slips in more than once. */
export function ThumbFallbackScript() {
  return <script dangerouslySetInnerHTML={{ __html: RUNTIME }} />;
}

export function Thumb({
  src, fallbackSrc, alt, caption, className, style,
  loading = 'lazy', fetchPriority, width = 480, height = 270,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  caption?: string;
  className?: string;
  style?: React.CSSProperties;
  /** 'eager' for the tiles above the fold; everything else stays lazy. */
  loading?: 'lazy' | 'eager';
  fetchPriority?: 'high' | 'low' | 'auto';
  /** Intrinsic size hint. 480x270 is hqdefault; small swatches pass their own. */
  width?: number;
  height?: number;
}) {
  return (
    <span className={`cs-thumb ${className ?? ''}`} style={{ display: 'block', ...style }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-cs-thumb=""
          data-cs-fallback={fallbackSrc || undefined}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      {caption && <span className="cs-thumb-cap">{caption}</span>}
    </span>
  );
}
