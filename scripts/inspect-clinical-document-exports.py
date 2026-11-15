"""Inspect only saved synthetic acceptance exports. Requires PyMuPDF; no database access."""
import json
import os
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf

out = Path(os.environ.get('CLINICAL_DOCUMENTS_EVIDENCE_DIR', 'docs/audits/clinical-documents-evidence'))
Path('.tmp-tools/clinical-audit').mkdir(parents=True, exist_ok=True)
reports = json.loads((out / 'report-results.json').read_text())
checks = []
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def check(value, operation):
    if not value:
        raise AssertionError(operation)
    checks.append({'operation': operation, 'status': 'PASS'})


def xlsx_values(path):
    with zipfile.ZipFile(path) as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            shared = [''.join(node.itertext()) for node in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        values = []
        for name in book.namelist():
            if not re.match(r'xl/worksheets/sheet\d+\.xml$', name):
                continue
            sheet = ET.fromstring(book.read(name))
            check(not sheet.findall('.//s:f', ns), str(path.name) + ' contains no executable formulas')
            for cell in sheet.findall('.//s:c', ns):
                value = cell.find('s:v', ns)
                if cell.attrib.get('t') == 'inlineStr':
                    values.append(''.join(cell.find('s:is', ns).itertext()))
                elif value is not None:
                    values.append(shared[int(value.text)] if cell.attrib.get('t') == 's' else value.text)
        return values


for report in reports:
    report_id = report['id']
    values = xlsx_values(out / (report_id + '.xlsx'))
    with pymupdf.open(out / (report_id + '.pdf')) as pdf:
        text = '\n'.join(page.get_text() for page in pdf)
        normalized = ' '.join(text.split())
        check(all('SYNTHETIC CLINICAL PRESENTATION FACILITY' in page.get_text() for page in pdf), report_id + ': correct template repeated on every page')
        check(all(f'Page {i + 1} of {len(pdf)}' in page.get_text() for i, page in enumerate(pdf)), report_id + ': correct page numbering')
        check('Synthetic isolated second facility' not in text, report_id + ': no other facility branding')
        for page in pdf:
            check(all(word[0] >= 0 and word[1] >= 0 and word[2] <= page.rect.width + 1 and word[3] <= page.rect.height + 1 for word in page.get_text('words')), report_id + ': no text clipped outside page geometry')
        for i, row in enumerate(report['rows']):
            section = re.split(r'\bRecord ' + str(i + 1) + r'\b', normalized)[1]
            if i + 1 < report['records']:
                section = re.split(r'\bRecord ' + str(i + 2) + r'\b', section)[0]
            for column in report['columns']:
                value = row.get(column['key'])
                formatted = 'Not recorded' if value is None or str(value).strip() == '' else ('KES ' if column.get('kind') == 'money' else '') + str(value)
                check(formatted in values, report_id + ': XLSX saved value for ' + column['key'])
                check(' '.join((column['label'] + ': ' + formatted).split()) in section, report_id + ': PDF saved row value for ' + column['key'])
        check(f'Records: {report["records"]}' in normalized, report_id + ': PDF count matches query')
        if report['records'] == 0:
            check('No records match the selected filters.' in text, report_id + ': explicit empty state, not invented records')
        if report_id == 'inventory-category':
            check(len(pdf) > 1 and 'Synthetic presentation item 34' in text, 'Full 35-row inventory PDF extends beyond visible screen pagination')
            check('Synthetic presentation item 34' in values, 'Full 35-row inventory XLSX extends beyond visible screen pagination')
            pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / 'report-after-activation-page1.png')
            pdf[-1].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / 'report-after-activation-last-page.png')
            for i, page in enumerate(pdf):
                page.get_pixmap().save(Path('.tmp-tools/clinical-audit') / f'inspect-inventory-page-{i+1}.png')

with pymupdf.open(out / 'report-before-activation.pdf') as pdf:
    text = '\n'.join(page.get_text() for page in pdf)
    check('SYNTHETIC CLINICAL PRESENTATION FACILITY' not in text, 'Before activation: no official template falsely applied')
    check('No active facility letterhead' in text or 'No facility letterhead' in text, 'Before activation: plain fallback clearly disclosed')
    pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / 'report-before-activation-page1.png')

with pymupdf.open(out / 'radiology-after-activation.pdf') as pdf:
    text = '\n'.join(page.get_text() for page in pdf)
    check('SYNTHETIC CLINICAL PRESENTATION FACILITY' in text and 'Synthetic impression only' in text, 'Radiology document: same active template and persisted clinical content')
    pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(out / 'radiology-after-activation-page1.png')

# Native browser downloads are additional evidence, not substitutes for source-row tests.
if (out / 'native-inventory.pdf').exists():
    values = xlsx_values(out / 'native-inventory.xlsx')
    with pymupdf.open(out / 'native-inventory.pdf') as pdf:
        text = ' '.join(' '.join(page.get_text() for page in pdf).split())
        check('Records: 35' in text, 'Native browser PDF has the complete35-row inventory, not just the displayed25')
        for i in range(35):
            name = f'Synthetic presentation item {i:02}'
            check(name in text and name in values, f'Native PDF/XLSX include exactly expected item{i:02}')
        check(sum(str(x).startswith('Synthetic presentation item ') for x in values) == 35, 'Native Excel has exactly35 saved item rows')
        columns = [c['label'] for c in next(r for r in reports if r['id'] == 'inventory-category')['columns']]
        start = values.index(columns[0])
        check(values[start:start+len(columns)] == columns, 'Native Excel columns match the generated report definition')
        cells = values[start+len(columns):]
        check(len(cells) == 35 * len(columns), 'Native Excel has exactly the full35-by8 data rectangle')
        for i in range(35):
            row = cells[i*len(columns):(i+1)*len(columns)]
            check(row[1:] == [f'Synthetic presentation item {i:02}', 'Synthetic supplies', 'Synthetic Main Store', 'Pieces', str(i+1), 'Not recorded', 'Active'], f'Native Excel row{i+1}: every saved data value equals the fixture')
            section = re.split(r'\bRecord ' + str(i+1) + r'\b', text)[1]
            if i < 34:
                section = re.split(r'\bRecord ' + str(i+2) + r'\b', section)[0]
            check(all(' '.join((col + ': ' + value).split()) in section for col,value in zip(columns,row)), f'Native PDF row{i+1}: every cell agrees with the actual native Excel row')
        check(all('SYNTHETIC CLINICAL PRESENTATION FACILITY' in page.get_text() for page in pdf), 'Native PDF repeats correct activated facility letterhead on every page')
        pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).save(out / 'native-inventory-first-page.png')
        pdf[-1].get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).save(out / 'native-inventory-last-page.png')
if (out / 'laboratory-after-activation.pdf').exists():
    with pymupdf.open(out / 'laboratory-after-activation.pdf') as pdf:
        text = ' '.join(' '.join(page.get_text() for page in pdf).split())
        check('SYNTHETIC CLINICAL PRESENTATION FACILITY' in text and '5.1' in text and 'All results on this report have been verified' in text, 'Lab PDF contains active facility identity, persisted verified value and final-verification disclosure')
        pdf[0].get_pixmap(matrix=pymupdf.Matrix(1.3,1.3)).save(out / 'laboratory-after-activation-page1.png')

(out / 'export-inspection.json').write_text(json.dumps({'syntheticOnly': True, 'reportEngines': len(reports), 'checks': checks}, indent=2) + '\n')
print(f'PASS {len(checks)} PDF/XLSX content and layout checks across {len(reports)} engines, plus clinical PDF and before/after fallback.')
