"""Inspect only saved synthetic acceptance exports. Requires PyMuPDF; no database access."""
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf

out = Path('docs/audits/clinical-documents-evidence')
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

(out / 'export-inspection.json').write_text(json.dumps({'syntheticOnly': True, 'reportEngines': len(reports), 'checks': checks}, indent=2) + '\n')
print(f'PASS {len(checks)} PDF/XLSX content and layout checks across {len(reports)} engines, plus clinical PDF and before/after fallback.')
