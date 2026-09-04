// Offline browser regression of the real component using the saved loadVideoPage output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'live-chart-preview-'));
  require('esbuild').buildSync({entryPoints:['docs/audits/livestream-preview/entry.tsx'],bundle:true,
    outfile:path.join(out,'bundle.js'),platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
  const html = fs.readFileSync('docs/audits/livestream-preview/index.html');
  const bundle = fs.readFileSync(path.join(out,'bundle.js'));
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser = await require('puppeteer').launch({headless:true});
    const page = await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1400,height:850});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
    const labels=await page.$$eval('.recharts-reference-dot .recharts-label',nodes=>nodes.map(n=>n.textContent));
    assert.equal(labels.filter(t=>t==='1.8K').length,1,'Latest reading must be labeled once, without a duplicate forecast endpoint');
    const text=await page.$eval('body',e=>e.innerText);
    assert(text.includes('Stream started Sep 3, 11:57 AM ET'));
    assert(!text.includes('0.8×'));assert(!text.includes('tentative projection'));
    await page.screenshot({path:'docs/audits/2026-09-04-livestream-desktop.png',fullPage:true});
    await page.setViewport({width:390,height:850});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    await page.screenshot({path:'docs/audits/2026-09-04-livestream-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: stream clock, withheld score/forecast, one endpoint label, desktop and mobile without overflow or page errors');
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
