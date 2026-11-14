/** Component/browser evidence from READ-ONLY disposable DB snapshots. Never connects to an application API. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
const scratch = '.tmp-tools/import-outcomes';
const fixture = JSON.parse(await readFile(path.join(scratch, 'browser-fixture.json'), 'utf8'));
if (fixture.syntheticOnly !== true || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error('Explicit synthetic fixture and Chromium required. No live API access.');
const output = 'docs/audits/planning-import-outcomes-evidence';
await mkdir(output, { recursive: true });
await writeFile(
  path.join(scratch, 'browser-entry.tsx'),
  `
import React from 'react';import{createRoot}from'react-dom/client';
import{ImportNotification,ImportOverview,ImportResultsPanel,noticeForBatch}from'../../src/components/modules/planning/ImportResults.tsx';
import{planningApi}from'../../src/api/clients/planning.client.ts';
const fixture=${JSON.stringify(fixture)};
let scenario=fixture.scenarios[0];window.__writes=[];window.__exports=[];
const block=(...args)=>{window.__writes.push(args);throw Error('Offline verification: API/mutations prohibited');};
planningApi.get=async(_facility,endpoint)=>endpoint==='/imports/summary'?scenario.summary:scenario.result;
planningApi.send=block;planningApi.upload=block;window.fetch=block;
planningApi.importResultsFile=async(_facility,_batch,errorsOnly)=>{window.__exports.push(errorsOnly);};
const root=createRoot(document.getElementById('root'));
window.__showScenario=(key)=>{scenario=fixture.scenarios.find(s=>s.key===key);root.render(<main style={{maxWidth:1350,margin:'24px auto',padding:16}}><h1 className="text-xl font-semibold">Import outcomes — disposable database verification</h1><p className="my-3">Read-only snapshots of synthetic tests, not a live facility session. This browser cannot upload, preview or confirm imports.</p><ImportNotification key={'notice'+key} notice={noticeForBatch(scenario.result.batch)} onOpen={()=>{}} onDismiss={()=>{}}/><div className="my-3"><ImportOverview key={'summary'+key} facilityId={scenario.result.destination?.facilityId??1} planId={scenario.result.destination?.planId}/></div><ImportResultsPanel key={'result'+key} facilityId={scenario.result.destination?.facilityId??1} batchId={scenario.result.batch.id} canExport onClose={()=>{}}/></main>);};window.__showScenario('preview');
`,
);
await build({
  entryPoints: [path.join(scratch, 'browser-entry.tsx')],
  outfile: path.join(scratch, 'browser-entry.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
const cssPath = (await readdir('dist/assets')).find((f) => f.endsWith('.css'));
if (!cssPath) throw Error('Build the frontend before browser verification.');
const assets = new Map<string, { type: string; body: Buffer | string }>([
  [
    '/',
    {
      type: 'text/html',
      body: '<!doctype html><html><head><title>Disposable import outcome verification</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
    },
  ],
  ['/style.css', { type: 'text/css', body: await readFile(path.join('dist/assets', cssPath)) }],
  [
    '/entry.js',
    { type: 'text/javascript', body: await readFile(path.join(scratch, 'browser-entry.js')) },
  ],
  [
    '/fonts/inter-latin-wght-normal.woff2',
    { type: 'font/woff2', body: await readFile('dist/fonts/inter-latin-wght-normal.woff2') },
  ],
]);
const server = createServer((req, res) => {
  const asset = assets.get(req.url ?? '');
  if (!asset) {
    res.statusCode = 404;
    res.end();
  } else {
    res.setHeader('Content-Type', asset.type);
    res.end(asset.body);
  }
});
await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('No local server address');
const errors: string[] = [],
  blocked: string[] = [],
  checks: string[] = [];
let passed = false;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    headless: true,
    args: JSON.parse(
      process.env.BUDGET_BROWSER_ARGS ??
        '["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]',
    ),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1550, height: 1100 });
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1' || (!assets.has(u.pathname) && u.pathname !== '/favicon.ico')) {
      blocked.push(r.url());
      void r.abort();
    } else void r.continue();
  });
  const check = (v: boolean, label: string) => {
    if (!v) throw Error(label);
    checks.push(label);
    console.log('PASS', label);
  };
  const click = (text: string) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent?.trim() === t);
      if (!b) throw Error('Button absent: ' + t);
      b.click();
    }, text);
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Awaiting confirmation') &&
      document.body.innerText.includes('VALID'),
  );
  check(
    await page.$eval(
      '[aria-label="Import outcome notification"]',
      (e) =>
        e.textContent!.includes('0 created') && !e.textContent!.includes('Successfully imported'),
    ),
    'Successful preview remains awaiting confirmation with zero created records',
  );
  await click('Successful');
  await page.waitForFunction(() => document.body.innerText.includes('0 of 1 recorded row results'));
  check(
    await page.$eval('[aria-label="Import full result"]', (e) =>
      e.textContent!.includes('Preview is not an import'),
    ),
    'Preview has no successful row outcomes',
  );
  await click('All');
  await page.screenshot({ path: path.join(output, '01-preview-not-imported.png'), fullPage: true });
  await page.evaluate(() => (window as any).__showScenario('committed'));
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Successfully imported') &&
      document.body.innerText.includes('CREATED'),
  );
  const committed = fixture.scenarios.find((s: any) => s.key === 'committed').result;
  check(
    await page.$eval(
      '[aria-label="Import outcome notification"]',
      (e, n) => e.textContent!.includes(`${n} created`),
      committed.counts.created,
    ),
    'Completed notification matches the actual disposable database receipt',
  );
  await click('Warnings');
  await page.waitForFunction(() =>
    document.body.innerText.includes('Duplicate name — distinct source row preserved.'),
  );
  check(
    await page.$eval(
      '[aria-label="Import full result"]',
      (e) =>
        e.textContent!.includes('DEFAULTED') &&
        e.textContent!.includes('SUPPLIED') &&
        e.textContent!.includes('RECALCULATED'),
    ),
    'Warnings retain defaulted, supplied and recalculated value origins',
  );
  await click('Export errors and warnings CSV');
  check(
    (await page.evaluate(() => (window as any).__exports)).includes(true),
    'Errors and warnings export action is reachable',
  );
  await page.screenshot({
    path: path.join(output, '02-committed-results-and-warnings.png'),
    fullPage: true,
  });
  await page.evaluate(() => (window as any).__showScenario('failed'));
  await page.waitForFunction(() => document.body.innerText.includes('CONFIRMATION_FAILED'));
  check(
    await page.$eval(
      '[aria-label="Import outcome notification"]',
      (e) => e.textContent!.includes('Failed') && e.textContent!.includes('0 created'),
    ),
    'Failed transaction is visible with zero committed creates',
  );
  await page.screenshot({ path: path.join(output, '03-failure-lifecycle.png'), fullPage: true });
  check(
    (await page.evaluate(() => (window as any).__writes.length)) === 0 && blocked.length === 0,
    'Browser made no API calls, previews, confirmations or other mutations',
  );
  check(errors.length === 0, 'No browser runtime errors');
  passed = true;
} finally {
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      {
        syntheticOnly: true,
        readOnlySnapshots: true,
        passed,
        checks,
        errors,
        blockedRequests: blocked,
      },
      null,
      2,
    ) + '\n',
  );
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
