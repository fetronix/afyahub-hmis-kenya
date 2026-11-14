/** Explicit in-memory demo of the real grid; no auth bypass and no application/database API. */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
if (process.env.FINANCIAL_BUDGET_DEMO !== 'YES')
  throw Error('Set FINANCIAL_BUDGET_DEMO=YES for the isolated in-memory demo.');
const scratch = '.tmp-tools/financial-budget';
await mkdir(scratch, { recursive: true });
await writeFile(
  path.join(scratch, 'demo-entry.tsx'),
  `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{FinancialBudgetGrid}from'../../src/components/modules/planning/AnnualFinancialBudget.tsx';
import{createFinancialBaseline}from'../../src/budget-planning/financial-budget.model.ts';
import{validateFinancialBudget}from'../../src/budget-planning/financial-budget.engine.ts';
import{financialCsv,financialExportRows}from'../../src/budget-planning/financial-budget.export.ts';
import * as XLSX from '@e965/xlsx';
window.fetch=()=>Promise.reject(new Error('Offline demo: application/network requests are prohibited.'));
function App(){const[model,setModel]=useState(createFinancialBaseline);const[status,setStatus]=useState('Demo only · changes live in this tab and disappear on refresh');return <main style={{maxWidth:1680,margin:'0 auto',padding:24}}><p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Interactive demonstration · user-supplied Syrona scenario · no live facility session, database access or accounting writes. Refresh discards demo edits. In JaliCare, use Planning → Annual Financial Budget with an authorized 2026 KES draft.</p><FinancialBudgetGrid model={model} canExport status={status} onChange={async(next)=>{validateFinancialBudget(next);setModel(next);setStatus('Updated in demo memory only — not saved to a facility');return true;}} onReset={async(confirmation,reason)=>{if(confirmation!=='RESET FINANCIAL BASELINE'||reason.trim().length<10||reason.trim().length>500)return false;setModel(createFinancialBaseline());return true;}} onExport={async(format,audit)=>{let data;if(format==='csv')data=financialCsv(model,audit);else {const wb=XLSX.utils.book_new();const rows=financialExportRows(model,audit).map((r,i)=>r.map((v,c)=>i>0&&c>=3&&/^-?\\d+(?:\\.\\d+)?$/.test(v)?Number(v):v));XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Budget 2026');data=XLSX.write(wb,{bookType:'xlsx',type:'array'});}const url=URL.createObjectURL(new Blob([data],{type:format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='syrona-2026-demo.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}/></main>;}createRoot(document.getElementById('root')).render(<App/>);
`,
);
await build({
  entryPoints: [path.join(scratch, 'demo-entry.tsx')],
  outfile: path.join(scratch, 'demo.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
});
const css = (await readdir('dist/assets')).find((p) => p.endsWith('.css'));
if (!css) throw Error('Run npm run build first for the stylesheet.');
const assets = new Map<string, { type: string; body: string | Buffer }>([
  [
    '/',
    {
      type: 'text/html',
      body: '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Syrona Medical Center — 2026 Annual Budget Demo</title><link rel="stylesheet" href="/style.css"></head><body style="background:#eef2f6"><div id="root"></div><script type="module" src="/demo.js"></script></body></html>',
    },
  ],
  ['/demo.js', { type: 'text/javascript', body: await readFile(path.join(scratch, 'demo.js')) }],
  ['/style.css', { type: 'text/css', body: await readFile(path.join('dist/assets', css)) }],
  [
    '/fonts/inter-latin-wght-normal.woff2',
    { type: 'font/woff2', body: await readFile('dist/fonts/inter-latin-wght-normal.woff2') },
  ],
]);
const server = createServer((req, res) => {
  const asset = assets.get(req.url ?? '');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' || !asset) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', asset.type);
  res.end(asset.body);
});
server.listen(Number(process.env.PORT ?? 5180), '0.0.0.0', () =>
  console.log(
    'Isolated annual financial budget demo ready. No application API or database connections.',
  ),
);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
