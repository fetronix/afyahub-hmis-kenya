import { parentPort, workerData } from 'node:worker_threads';
import * as XLSX from '@e965/xlsx';
import { unzipSync } from 'fflate';
try {
  const bytes = Buffer.from(workerData);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let expanded = 0,
      count = 0;
    const zip = unzipSync(bytes, {
      filter: (file) => {
        expanded += file.originalSize;
        count++;
        if (
          expanded > 20 * 1024 * 1024 ||
          count > 1000 ||
          /vbaProject|externalLinks/i.test(file.name)
        )
          throw new Error('Workbook archive is too large or contains macros/external links.');
        return false;
      },
    });
    void zip;
  }
  const book = XLSX.read(bytes, {
    type: 'buffer',
    cellFormula: true,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    sheetRows: 2001,
    bookVBA: true,
    bookDeps: false,
  });
  if (book.vbaraw) throw new Error('Macro-enabled workbooks are not accepted.');
  if (book.SheetNames.length > 12) throw new Error('Maximum twelve worksheets.');
  let cellCount = 0;
  const sheets = book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (range && (range.e.r >= 2000 || range.e.c >= 80))
      throw new Error('Worksheet exceeds 2000 rows or 80 columns. Split the planning workbook.');
    const rows = [];
    for (let r = 0; range && r <= range.e.r; r++) {
      const row = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        cellCount++;
        if (cellCount > 150000) throw new Error('Too many workbook cells.');
        row.push(
          cell
            ? {
                value:
                  cell.v === undefined
                    ? null
                    : typeof cell.v === 'string'
                      ? cell.v.slice(0, 1000)
                      : cell.v,
                formula: cell.f ? String(cell.f).slice(0, 1000) : undefined,
              }
            : null,
        );
      }
      rows.push(row);
    }
    return { name, rows };
  });
  parentPort.postMessage({ sheets });
} catch (error) {
  parentPort.postMessage({ error: error.message || 'Workbook could not be parsed.' });
}
