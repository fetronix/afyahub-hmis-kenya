"""Inspect native browser downloads from the synthetic stock-movement acceptance only.
Requires PyMuPDF. No SQL, network, workbook calculation or production access.
"""
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf

out = Path('docs/audits/reporting-programme-batch-1-evidence')
result = json.loads((out / 'report-result.json').read_text())
checks = []
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def check(ok, operation):
    if not ok:
        raise AssertionError(operation)
    checks.append(operation)


def workbook(path):
    with zipfile.ZipFile(path) as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            shared = [''.join(node.itertext()) for node in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        sheet = ET.fromstring(book.read('xl/worksheets/sheet1.xml'))
        check(not sheet.findall('.//s:f', ns), path.name + ': no executable formulas')
        rows = []
        for row in sheet.findall('.//s:sheetData/s:row', ns):
            values = []
            for cell in row.findall('s:c', ns):
                value = cell.find('s:v', ns)
                if cell.attrib.get('t') == 'inlineStr':
                    values.append(''.join(cell.find('s:is', ns).itertext()))
                elif value is not None:
                    values.append(shared[int(value.text)] if cell.attrib.get('t') == 's' else value.text)
                else:
                    values.append('')
            rows.append(values)
        return rows


rows = workbook(out / 'movements.xlsx')
headers = [c['label'] for c in result['columns']]
index = rows.index(headers)
data = rows[index + 1:]
check(len(data) == result['total'] == 5, 'Actual XLSX has exactly all five returned scoped movement rows')
with pymupdf.open(out / 'movements.pdf') as pdf:
    text = ' '.join('\n'.join(page.get_text() for page in pdf).split())
    check('Records: 5' in text, 'PDF count agrees with screen/source snapshot')
    check('Recorded movement date: 2026-01-01 to 2026-01-31 (inclusive)' in text, 'PDF displays actual applied inclusive date range')
    for i, page in enumerate(pdf):
        page_text = page.get_text()
        check('SYNTHETIC REPORTING PROGRAMME MAIN' in page_text, f'Active same-facility letterhead repeated on page {i+1}')
        check(f'Page {i+1} of {len(pdf)}' in page_text, f'Correct page numbering {i+1}')
        check(all(word[0] >= 0 and word[1] >= 0 and word[2] <= page.rect.width + 1 and word[3] <= page.rect.height + 1 for word in page.get_text('words')), f'No text outside PDF page {i+1}')
    for i, row in enumerate(result['rows']):
        expected = ['Not recorded' if row.get(c['key']) is None or str(row.get(c['key'])).strip() == '' else str(row[c['key']]) for c in result['columns']]
        check(data[i] == expected, f'XLSX row {i+1}: every saved cell exactly equals the generated screen/source value')
        section = re.split(r'\bRecord ' + str(i+1) + r'\b', text)[1]
        if i + 1 < len(data):
            section = re.split(r'\bRecord ' + str(i+2) + r'\b', section)[0]
        for col, value in zip(headers, expected):
            check(' '.join((col + ': ' + value).split()) in section, f'PDF row {i+1}: exact {col}')
    check('Sibling Secret' not in text and 'Foreign Secret' not in text, 'No out-of-scope item metadata in PDF')
    pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / '05-branded-pdf-first-page.png')
    pdf[-1].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / '06-branded-pdf-last-page.png')

for name in ['movements-before-activation', 'movements-empty']:
    with pymupdf.open(out / (name + '.pdf')) as pdf:
        text = '\n'.join(page.get_text() for page in pdf)
        if name.endswith('activation'):
            check('SYNTHETIC REPORTING PROGRAMME MAIN' not in text and 'No active facility letterhead' in text, 'Before explicit activation: disclosed plain fallback, no false official stationery')
            pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / '07-before-activation-pdf.png')
        else:
            check('Records: 0' in text and 'No records match the selected filters.' in text, 'Empty PDF explicitly reports no matching records, not invented stock/net quantity')
            check('Synthetic Alpha' not in text and 'Synthetic Beta' not in text, 'Empty PDF contains no stale rows')
            check('SYNTHETIC REPORTING PROGRAMME MAIN' in text, 'Empty PDF retains active facility letterhead')
empty = workbook(out / 'movements-empty.xlsx')
check(len(empty[empty.index(headers)+1:]) == 0, 'Empty XLSX contains headers with no invented movement rows')
check('7' not in [cell for row in empty for cell in row], 'Empty XLSX does not carry previous per-item net')
check('Sibling Secret' not in str(rows) and 'Foreign Secret' not in str(rows), 'No out-of-scope item metadata in XLSX')
alpha = [row for row in data if row[headers.index('Current item name')] == 'Synthetic Alpha']
beta = [row for row in data if row[headers.index('Current item name')] == 'Synthetic Beta']
check(all(row[headers.index('Item net quantity in selected filters')] == '7' for row in alpha), 'XLSX per-item Alpha net is exactly +10 -3 = 7')
check(all(row[headers.index('Item net quantity in selected filters')] == '80' for row in beta), 'XLSX per-item Beta net is exactly +100 -20 = 80; units are not combined')
(out / 'export-inspection.json').write_text(json.dumps({'syntheticOnly': True, 'nativeBrowserDownloads': True, 'checks': checks}, indent=2) + '\n')
print(f'PASS: {len(checks)} actual PDF/XLSX content, scope, calculation, empty-state and letterhead checks')
