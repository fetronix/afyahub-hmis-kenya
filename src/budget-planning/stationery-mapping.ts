import type { Mapping, Workbook } from './workbook.ts';

/** Reviewed source fingerprint, not a filename/tenant/plan inference. Changed files fail closed. */
export const STATIONERY_SOURCE_SHA256 =
  '244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1';
const quantityColumns = ['F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB'];
const sections = [
  { heading: 8, category: 'OPD CONSUMABLES', startRow: 9, endRow: 141 },
  { heading: 144, category: 'DENTAL CONSUABLES', startRow: 145, endRow: 184 },
  { heading: 185, category: 'CONSUMABLE ITEMS', startRow: 186, endRow: 244 },
];

/** Read-only mapping suggestion for the exact reviewed CSV; never evaluates or previews costs. */
export function verifiedStationeryMapping(book: Workbook, sourceSha256: string) {
  if (sourceSha256 !== STATIONERY_SOURCE_SHA256 || book.sheets.length !== 1) return null;
  const sheet = book.sheets[0];
  if (sheet.name !== 'CSV' || sheet.rows.length !== 296) return null;
  const value = (row: number, col: number) => {
    const cell = sheet.rows[row - 1]?.[col];
    return cell?.formula ? '' : String(cell?.value ?? '').trim();
  };
  if (
    value(6, 1) !== 'Documents' ||
    value(6, 2) !== 'Units' ||
    value(6, 3) !== 'Price per item' ||
    value(6, 4) !== 'Price inclusive of 5% inflation' ||
    value(248, 1) !== 'TOTAL'
  )
    return null;
  const monthLabels = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  for (let m = 0; m < 12; m++) {
    const col = 5 + m * 2;
    if (
      value(6, col) !== `${monthLabels[m]}-26` ||
      value(7, col) !== 'Units required' ||
      value(7, col + 1) !== 'Projected cost'
    )
      return null;
  }
  for (const section of sections) {
    if (value(section.heading, 1) !== section.category || value(section.heading, 0)) return null;
    for (let n = section.startRow; n <= section.endRow; n++) {
      if (
        !/^\d+$/.test(value(n, 0)) ||
        !value(n, 1) ||
        /^(TOTAL|.*CONSUMABLES|DENTAL CONSUABLES|CONSUMABLE ITEMS)$/i.test(value(n, 1))
      )
        return null;
    }
  }
  const mappings: Mapping[] = sections.map(({ category, startRow, endRow }) => ({
    sheet: 'CSV',
    kind: 'ITEM',
    category,
    startRow,
    endRow,
    description: 'B',
    unit: 'C',
    price: 'D',
    months: [...quantityColumns],
  }));
  return {
    sourceSha256,
    sourceRows: 296,
    itemRows: 232,
    excludedRows: 64,
    mappings,
  };
}
