// Real-browser test of the Channel Ingest extension: loads it into Chromium,
// verifies the service worker registers (the bug class Dia caught), exercises
// URL parsing, and performs a real click-ingest enqueue to the touch_queue.
import puppeteer from 'puppeteer';

const EXT = new URL('../chrome-extension', import.meta.url).pathname;
const browser = await puppeteer.launch({
  headless: false, // extensions need headful (or headless=new); use headful for fidelity
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
});

try {
  // 1. Service worker must register without errors
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
    { timeout: 15000 }
  );
  console.log('PASS service worker registered:', swTarget.url());
  // 2. Exercise the real parse + enqueue path in the popup page context
  // (dynamic import is banned in SW scope; the popup is the real user path)
  const extId = new URL(swTarget.url()).hostname;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html`);
  const results = await page.evaluate(async () => {
    const { parseYouTubeUrl, enqueue } = await import('./shared.js');
    const cases = {
      video: parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      channel: parseYouTubeUrl('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ'),
      handle: parseYouTubeUrl('https://www.youtube.com/@mkbhd/videos'),
      notYt: parseYouTubeUrl('https://example.com/watch?v=x'),
    };
    const enq = await enqueue([
      { kind: 'channel', ref: 'UC_TEST_EXTENSION_E2E', source_url: 'test', mode: 'click' },
    ]);
    return { cases, enq };
  });
  console.log('parse cases:', JSON.stringify(results.cases));
  console.log(results.enq.ok ? 'PASS enqueue wrote to touch_queue' : `FAIL enqueue: ${JSON.stringify(results.enq)}`);

  const ok =
    results.cases.video?.ref === 'dQw4w9WgXcQ' &&
    results.cases.channel?.kind === 'channel' &&
    results.cases.handle?.ref === '@mkbhd' &&
    results.cases.notYt === null &&
    results.enq.ok;
  console.log(ok ? 'ALL PASS' : 'FAILURES PRESENT');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
