/** Offline component verification only: no database, login, upload, preview or confirmation. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { parseWorkbook } from '../src/budget-planning/workbook.ts';
import { verifiedStationeryMapping } from '../src/budget-planning/stationery-mapping.ts';

if (!process.env.SYRONA_SOURCE_DIR || !process.env.CHROME_EXECUTABLE_PATH)
  throw Error(
    'Original source directory and Chromium executable required. Offline verification only.',
  );
const bytes = await readFile(path.join(process.env.SYRONA_SOURCE_DIR, 'Syrona_Stationery.csv'));
const hash = createHash('sha256').update(bytes).digest('hex');
const book = await parseWorkbook(bytes, 'Syrona_Stationery.csv', 'text/csv');
const verifiedMapping = verifiedStationeryMapping(book, hash);
if (!verifiedMapping) throw Error('Source does not match the reviewed structure; no guessing.');
const scratch = '.tmp-tools/stationery-mapping/browser';
const output = 'docs/audits/stationery-mapping-evidence';
await mkdir(scratch, { recursive: true });
await mkdir(output, { recursive: true });
const batch = {
  id: 7,
  status: 'UPLOADED',
  filename: 'Syrona_Stationery.csv',
  sha256: hash,
  byte_size: bytes.length,
  created_at: '2026-10-27T00:00:00.000Z', // Explicitly mocked display metadata, not an upload timestamp.
  verifiedMapping,
  sheets: book.sheets.map((s) => ({
    name: s.name,
    rows: s.rows.length,
    preview: s.rows.slice(0, 40),
  })),
};
await writeFile(
  path.join(scratch, 'entry.tsx'),
  `
import React from 'react';
import{createRoot}from'react-dom/client';
import{PlanningImport}from'../../../src/components/modules/planning/PlanningImport.tsx';
import{planningApi}from'../../../src/api/clients/planning.client.ts';
const batch=${JSON.stringify(batch)};
const plan={id:1,name:'Syrona Medical Center Annual Plan 2026',financial_year:2026,plan_type:'MIXED',currency:'KES',inflation_bp:500,status:'DRAFT',version:3};
window.__writes=[];
const block=(...args)=>{window.__writes.push(args);throw Error('All mutations including preview are prohibited in this offline verifier');};
planningApi.get=async(_facility,endpoint)=> endpoint==='/imports'?[batch]:endpoint==='/imports/7'?batch:{plans:[plan],total:1};
planningApi.send=block;planningApi.upload=block;window.fetch=block;
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1350,margin:'24px auto',padding:16}}><h1 className="text-xl font-semibold">Stationery mapping — OFFLINE component verification</h1><p className="my-3">Original CSV parsed locally. Plan API responses are mocked; no live facility, database, preview or import is accessed.</p><PlanningImport facilityId={1} plans={[]} onImported={()=>block('onImported')}/></main>);
`,
);
await build({
  entryPoints: [path.join(scratch, 'entry.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(scratch, 'entry.js'),
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
const cssFile = (await readdir('dist/assets')).find((f) => f.endsWith('.css'));
if (!cssFile) throw Error('Run npm run build before browser verification.');
const css = await readFile(path.join('dist/assets', cssFile));
const js = await readFile(path.join(scratch, 'entry.js'));
const font = await readFile('dist/fonts/inter-latin-wght-normal.woff2');
const server = createServer((req, res) => {
  if (req.url === '/entry.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(js);
  } else if (req.url === '/style.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(css);
  } else if (req.url === '/fonts/inter-latin-wght-normal.woff2') {
    res.setHeader('Content-Type', 'font/woff2');
    res.end(font);
  } else if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><html><head><title>Offline stationery mapping verification</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
    );
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('No local port');
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const checks: string[] = [],
  errors: string[] = [],
  requests: string[] = [];
let passed = false;
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
  await page.setViewport({ width: 1500, height: 1100 });
  page.on('pageerror', (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (
      ![
        '/',
        '/entry.js',
        '/style.css',
        '/favicon.ico',
        '/fonts/inter-latin-wght-normal.woff2',
      ].includes(url.pathname) ||
      url.hostname !== '127.0.0.1'
    ) {
      requests.push(r.url());
      void r.abort();
    } else void r.continue();
  });
  const check = (condition: boolean, label: string) => {
    if (!condition) throw Error(label);
    checks.push(label);
    console.log('PASS', label);
  };
  const click = async (text: string) => {
    await page.waitForFunction(
      (t) =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === t && !b.matches(':disabled'),
        ),
      {},
      text,
    );
    await page.evaluate(
      (t) =>
        (
          [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === t,
          ) as HTMLButtonElement
        ).click(),
      text,
    );
  };
  const input = (label: string) =>
    page.evaluate(
      (text) =>
        [...document.querySelectorAll('label')]
          .filter((l) => l.textContent?.trim().startsWith(text))
          .map((l) => (l.querySelector('input,select') as HTMLInputElement).value),
      label,
    );
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await click('Review batch 7');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('option')].some(
      (o) => o.textContent?.includes('MIXED') && o.value === '1',
    ),
  );
  await page.evaluate(() =>
    document.querySelectorAll('select').forEach((s) => {
      if (s.closest('label')?.textContent?.trim().startsWith('Existing destination plan'))
        s.setAttribute('data-target', 'yes');
    }),
  );
  await page.select('[data-target]', '1');
  await click('Add source/category mapping block');
  check(
    (await input('First source row'))[0] === '1' && (await input('Description column'))[0] === '',
    'Incomplete 1–1 block is reproduced with empty column mappings',
  );
  check(
    await page.$eval(
      '[aria-label="Verified stationery source mapping"] button',
      (b) => (b as HTMLButtonElement).disabled,
    ),
    'Verified mapping does not overwrite an existing manual block',
  );
  await page.$eval('[aria-label="Verified stationery source mapping"]', (e) =>
    e.scrollIntoView({ block: 'center' }),
  );
  await page.screenshot({
    path: path.join(output, '01-incomplete-block-offline.png'),
    fullPage: true,
  });
  await click('Remove mapping block');
  await click('Use verified stationery mappings');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === 'Remove mapping block',
      ).length === 3,
  );
  check(
    JSON.stringify(await input('First source row')) === '["9","145","186"]' &&
      JSON.stringify(await input('Last source row')) === '["141","184","244"]',
    'All three verified 1-based source ranges are filled',
  );
  check(
    JSON.stringify(await input('Source category')) ===
      '["OPD CONSUMABLES","DENTAL CONSUABLES","CONSUMABLE ITEMS"]',
    'Original category spelling is preserved',
  );
  for (const [label, expected] of [
    ['Description column', 'B'],
    ['Unit column', 'C'],
    ['Base price column', 'D'],
  ])
    check(
      (await input(label)).every((v) => v === expected),
      label + ' is ' + expected + ' in all three blocks',
    );
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  check(
    (await Promise.all(monthNames.map((m) => input(m + ' qty column')))).every(
      (values, n) =>
        values.length === 3 && values.every((v) => v === verifiedMapping.mappings[0].months![n]),
    ),
    'All 36 monthly mapping fields use quantities, never projected costs',
  );
  check(
    (await input('Existing destination plan'))[0] === '1' &&
      (await input('Plan type'))[0] === 'MIXED' &&
      (await input('Currency'))[0] === 'KES' &&
      (await input('Import inflation percentage'))[0] === '5',
    'Existing plan and assumptions remain selected',
  );
  await page.$eval('[aria-label="Verified stationery source mapping"]', (e) =>
    e.scrollIntoView({ block: 'start' }),
  );
  await page.screenshot({
    path: path.join(output, '02-verified-mappings-offline.png'),
    fullPage: true,
  });
  check(
    (await page.evaluate(() => (window as any).__writes.length)) === 0 && requests.length === 0,
    'No upload, preview, confirmation, plan creation, API request or other mutation occurred',
  );
  check(errors.length === 0, 'No browser runtime errors');
  passed = true;
} finally {
  await writeFile(
    path.join(output, 'browser-results.json'),
    JSON.stringify(
      {
        offlineOnly: true,
        realDatabaseAccessed: false,
        passed,
        checks,
        errors,
        unexpectedRequests: requests,
        sourceSha256: hash,
        mappings: verifiedMapping.mappings,
      },
      null,
      2,
    ) + '\n',
  );
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}
