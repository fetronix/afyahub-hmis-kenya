import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  PDFArray,
  PDFDict,
  PDFNull,
  PDFRef,
} from 'pdf-lib';
import { validatePatientFile } from '../../documents/patient-file-validation.ts';
import { inspectLetterheadPdf } from '../../branding/letterhead-pdf.ts';
import { staticPdfPreview } from '../../security/pdf-preview.ts';
import { pdfCompatibilityFixtures } from '../fixtures/pdf-compatibility.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const actualPath = 'src/tests/fixtures/letterhead-sample-a4.pdf';
const actualSha = '7650930b5229cd57f58bda9788162b2f56967ba9a72e0aa1cdfa0256adb00ce0';
async function linked(
  uri: string | object,
  extra: Record<string, any> = {},
  location = 'Link',
  indirect = false,
) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText('Synthetic link security test - static artwork');
  const action = pdf.context.obj({
    Type: 'Action',
    S: 'URI',
    URI: typeof uri === 'string' ? PDFString.of(uri) : uri,
    ...extra,
  } as any) as unknown as PDFDict;
  const ref = indirect ? pdf.context.register(action) : action;
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: location === 'Text' ? 'Text' : 'Link',
      Rect: [20, 20, 200, 40],
      A: ref,
    } as any),
  );
  if (location !== 'orphan') page.node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  if (location === 'OpenAction') pdf.catalog.set(PDFName.of('OpenAction'), ref);
  if (location === 'AA') page.node.set(PDFName.of('AA'), pdf.context.obj({ O: ref }));
  if (location === 'orphan') pdf.context.register(action);
  return Buffer.from(await pdf.save());
}
async function accept(bytes: Buffer) {
  await validatePatientFile(bytes, 'file.pdf', 'application/pdf');
  await inspectLetterheadPdf(bytes, { filename: 'file.pdf', mimeType: 'application/pdf' });
}
async function reject(bytes: Buffer) {
  await expect(validatePatientFile(bytes, 'file.pdf', 'application/pdf')).rejects.toMatchObject({
    code: 'UNSAFE_PDF',
  });
  await expect(
    inspectLetterheadPdf(bytes, { filename: 'file.pdf', mimeType: 'application/pdf' }),
  ).rejects.toMatchObject({ code: 'LETTERHEAD_UNSAFE_CONTENT' });
}

describe('Validated website URI links and non-navigable ephemeral previews', () => {
  it('uses the exact supplied LETTER HEAD.pdf and preserves its original hash/bytes', async () => {
    const bytes = await readFile(actualPath),
      before = Buffer.from(bytes);
    expect(sha(bytes)).toBe(actualSha);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const link = pdf.context.lookup(PDFRef.of(40));
    expect(link).toBeInstanceOf(PDFDict);
    expect(String((link as PDFDict).get(PDFName.of('Subtype')))).toBe('/Link');
    const action = (link as PDFDict).lookup(PDFName.of('A'), PDFDict);
    expect(String(action.get(PDFName.of('S')))).toBe('/URI');
    expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe(
      'http://www.syronamedicalcenter.co.ke/',
    );
    await accept(bytes);
    const preview = await staticPdfPreview(bytes);
    expect(preview.derived).toBe(true);
    expect(sha(preview.bytes)).not.toBe(actualSha);
    const derived = await PDFDocument.load(preview.bytes);
    expect(derived.getPageCount()).toBe(1);
    expect(derived.getTitle()).toContain('Derived static preview');
    const annots = derived.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    for (const raw of annots.asArray()) {
      const a = derived.context.lookup(raw, PDFDict);
      expect(a.has(PDFName.of('A'))).toBe(false);
      expect(a.has(PDFName.of('Dest'))).toBe(false);
    }
    for (const [, o] of derived.context.enumerateIndirectObjects())
      if (o instanceof PDFDict) expect(String(o.get(PDFName.of('S')))).not.toBe('/URI');
    expect(bytes).toEqual(before);
    expect(sha(bytes)).toBe(actualSha);
  });
  it.each([
    'http://www.syronamedicalcenter.co.ke/',
    'https://example.test/path?q=a#section',
    'HTTP://EXAMPLE.TEST/',
    'https://example.test:8443/',
    'https://[2001:db8::1]/',
  ])('allows ordinary absolute website URI %s', async (uri) => {
    await accept(await linked(uri));
  });
  it('allows PDF hex-string and indirect URI actions, and inert IsMap false', async () => {
    for (const b of [
      await linked(PDFHexString.fromText('https://example.test/')),
      await linked('https://example.test/', { IsMap: false }, 'Link', true),
    ]) {
      await accept(b);
      const p = await staticPdfPreview(b);
      expect(p.derived).toBe(true);
      await accept(Buffer.from(p.bytes));
    }
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///tmp/a',
    'ftp://example.test/a',
    'mailto:a@example.test',
    'tel:+254700000000',
    'vbscript:msgbox(1)',
    '//example.test/',
    '/relative',
    'https:example.test',
    ' https://example.test',
    'https://example.test/\n',
    'https://example.test/\u0000x',
    'https://example.test/%0d%0aX',
    'https://example.test/%00',
    'https://example.test/%5c@evil.test',
    'https://example.test/%7f',
    'https://example.test/%',
    'https://user:secret@example.test/',
    'https://example.test\\@evil.test/',
    'https:///',
    'https://',
    'https://example.test:99999/',
  ])('rejects unsupported/malformed URI %s', async (uri) => {
    await reject(await linked(uri));
  });
  it.each(['OpenAction', 'AA', 'Text', 'orphan'])(
    'does not authorize URI actions in %s, even if aliased from a Link',
    async (location) => {
      await reject(await linked('https://example.test/', {}, location, true));
    },
  );
  it.each([
    { Next: { S: 'JavaScript', JS: PDFString.of('synthetic') } },
    { Next: { S: 'URI', URI: PDFString.of('https://example.test/') } },
    { IsMap: true },
    { Type: 'Example' },
    { S: 'Launch', F: PDFString.of('synthetic.exe') },
    { S: 'JavaScript', JS: PDFString.of('synthetic') },
  ])('rejects action chaining or unexpected action flags %j', async (extra) => {
    await reject(await linked('https://example.test/', extra));
  });
  it.each([PDFName.of('https://example.test/'), PDFNull])(
    'rejects non-string URI targets rather than coercing PDF objects %s',
    async (target) => {
      await reject(await linked(target));
    },
  );
  it('removes permitted local Link destinations and OpenAction from the derived preview', async () => {
    const fixtures = await pdfCompatibilityFixtures();
    for (const name of ['internal-link', 'local-navigation']) {
      const bytes = fixtures.find((f) => f.name === name)!.bytes;
      const result = await staticPdfPreview(bytes);
      expect(result.derived).toBe(true);
      const derived = await PDFDocument.load(result.bytes);
      expect(derived.catalog.has(PDFName.of('OpenAction'))).toBe(false);
      for (const page of derived.getPages()) {
        const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
        for (const raw of annots.asArray()) {
          const annot = derived.context.lookup(raw, PDFDict);
          expect(annot.has(PDFName.of('A'))).toBe(false);
          expect(annot.has(PDFName.of('Dest'))).toBe(false);
        }
      }
      await accept(Buffer.from(result.bytes));
    }
  });
  it('fails preview closed on unsafe originals, never stripping then accepting them', async () => {
    const fixtures = await pdfCompatibilityFixtures();
    for (const f of fixtures.filter((f) => !f.supported)) {
      const before = sha(f.bytes);
      await expect(staticPdfPreview(f.bytes)).rejects.toMatchObject({
        name: 'Error',
        message: expect.stringContaining('safe static PDF preview'),
      });
      expect(sha(f.bytes)).toBe(before);
    }
  });
  it('leaves ordinary no-navigation PDFs byte-for-byte unchanged', async () => {
    const f = (await pdfCompatibilityFixtures()).find((f) => f.name === 'static-text')!;
    const r = await staticPdfPreview(f.bytes);
    expect(r.derived).toBe(false);
    expect(Buffer.from(r.bytes)).toEqual(f.bytes);
  });
});
