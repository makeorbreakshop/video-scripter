// The fallback behaviour behind <Thumb>, as one self-contained function.
//
// Archived versions live in R2, but the earliest versions of a video the watcher only started
// following after publish were never captured, so some URLs 404. A broken <img> shows its alt
// text in a jagged box, which reads as a bug; this swaps once to the local archive route and
// then hides the image, leaving the empty 16:9 plate.
//
// It runs as delegation on `document` rather than as a React handler so a page can render a
// hundred thumbnails without hydrating a component per tile. React 19 drops lowercase `on*`
// props on both the server and the client renderer (setProp / pushAttribute ignore any prop
// starting with "on" that is not a known synthetic event), so an inline `onerror=""` attribute
// string is not an option — one delegated capture listener per document is.
//
// Two ways in, because an image can fail before any script runs: the capture listener catches
// live errors, and the scans catch an <img> that finished with no pixels, which is what a 404
// leaves behind.
//
// Kept free of imports and closure variables: <Thumb> stringifies it into an inline <script>,
// and client components import it directly.
export function installThumbFallback() {
  var d = typeof document !== 'undefined' ? (document as any) : null;
  if (!d || d.__csThumbFallback) return;
  d.__csThumbFallback = true;

  var fix = function (el: any) {
    if (!el || el.tagName !== 'IMG' || !el.hasAttribute('data-cs-thumb')) return;
    var fb = el.getAttribute('data-cs-fallback');
    if (fb && el.getAttribute('data-cs-state') !== 'fallback' && el.src !== fb) {
      el.setAttribute('data-cs-state', 'fallback');
      el.src = fb;
      return;
    }
    el.setAttribute('data-cs-state', 'dead');
    el.style.visibility = 'hidden';
  };

  d.addEventListener('error', function (e: any) { fix(e.target); }, true);

  var scan = function () {
    var list = d.querySelectorAll('img[data-cs-thumb]');
    for (var i = 0; i < list.length; i++) {
      var im = list[i];
      if (im.complete && im.naturalWidth === 0) fix(im);
    }
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', scan);
  else scan();
  if (typeof window !== 'undefined') window.addEventListener('load', scan);
}
