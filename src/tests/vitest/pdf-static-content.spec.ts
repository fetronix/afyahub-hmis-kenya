import { beforeAll, describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  pdfCompatibilityFixtures,
  legacyPdfRejection,
  type PdfFixture,
} from '../fixtures/pdf-compatibility.ts';
import { validatePatientFile, documentLimit } from '../../documents/patient-file-validation.ts';
import { inspectLetterheadPdf } from '../../branding/letterhead-pdf.ts';

describe('Parsed PDF static-content compatibility and fail-closed active-content inspection', () => {
  let fixtures: PdfFixture[];
  beforeAll(async () => {
    fixtures = await pdfCompatibilityFixtures();
  });
  const safe = [
    'static-text',
    'scanned-letterhead',
    'images',
    'scanned-signature',
    'graphics',
    'type3-glyph-A',
    'tagged-layout-A',
    'initial-view-fit',
    'static-annotations',
    'internal-link',
    'form-xobject',
    'local-navigation',
  ];
  const blocked = [
    'javascript',
    'escaped-javascript',
    'additional-javascript',
    'launch',
    'attachments',
    'interactive-form',
    'external-link',
    'unsupported-media',
    'corrupted',
  ];
  it.each(safe)(
    'accepts %s in both patient uploads and facility letterheads without changing bytes',
    async (name) => {
      const f = fixtures.find((f) => f.name === name)!;
      const original = Buffer.from(f.bytes),
        hash = createHash('sha256').update(f.bytes).digest('hex');
      await expect(
        validatePatientFile(f.bytes, name + '.pdf', 'application/pdf'),
      ).resolves.toBeUndefined();
      await expect(
        inspectLetterheadPdf(f.bytes, { filename: name + '.pdf', mimeType: 'application/pdf' }),
      ).resolves.toMatchObject({ pages: 1 });
      expect(f.bytes).toEqual(original);
      expect(createHash('sha256').update(f.bytes).digest('hex')).toBe(hash);
    },
  );
  it.each(blocked)(
    'rejects %s with feature-specific safe messages on both upload surfaces',
    async (name) => {
      const f = fixtures.find((f) => f.name === name)!;
      await expect(
        validatePatientFile(f.bytes, name + '.pdf', 'application/pdf'),
      ).rejects.toMatchObject({ message: expect.stringContaining(f.message!) });
      if (name !== 'corrupted')
        await expect(
          inspectLetterheadPdf(f.bytes, { filename: name + '.pdf', mimeType: 'application/pdf' }),
        ).rejects.toMatchObject({
          code: 'LETTERHEAD_UNSAFE_CONTENT',
          message: expect.stringContaining(f.message!),
        });
    },
  );
  it.each(['type3-glyph-A', 'tagged-layout-A', 'initial-view-fit', 'static-annotations'])(
    'reproduces the exact old dictionary-name false positive for %s',
    async (name) => {
      const f = fixtures.find((f) => f.name === name)!;
      expect(await legacyPdfRejection(f.bytes)).toMatch(
        name === 'initial-view-fit' ? /\/OpenAction$/ : /\/A$/,
      );
    },
  );
  it('rejects oversized PDFs before parsing and retains extension/MIME checks', async () => {
    await expect(
      validatePatientFile(Buffer.alloc(documentLimit() + 1), 'large.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TOO_LARGE', status: 413 });
    const f = fixtures[0];
    await expect(validatePatientFile(f.bytes, 'x.jpg', 'application/pdf')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
    });
    await expect(validatePatientFile(f.bytes, 'x.pdf', 'image/png')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DOCUMENT',
    });
  });
  it('does not treat ordinary text mentioning action keywords as an action', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('/JS /JavaScript /A /OpenAction are printed words', { size: 12 });
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'text.pdf', 'application/pdf'),
    ).resolves.toBeUndefined();
  });
  it('does not allow action dictionaries masquerading as Type3 glyph streams', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.register(
      pdf.context.obj({
        Type: 'Font',
        Subtype: 'Type3',
        CharProcs: { A: { S: 'JavaScript', JS: PDFString.of('synthetic') } },
      }),
    );
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'spoof.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
  });
  it('still inspects dictionaries of actual glyph streams', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const glyph = pdf.context.register(
      pdf.context.flateStream('0 0 d0', {
        AA: { O: { S: 'JavaScript', JS: PDFString.of('synthetic') } },
      }),
    );
    pdf.context.register(
      pdf.context.obj({ Type: 'Font', Subtype: 'Type3', CharProcs: { A: glyph } }),
    );
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'spoof.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ message: expect.stringContaining('JavaScript') });
  });
  it('rejects real actions even when their dictionary is also used as a structure attribute', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const attr = pdf.context.register(pdf.context.obj({ O: 'Layout' }));
    pdf.context.register(pdf.context.obj({ Type: 'StructElem', A: attr }));
    page.node.set(PDFName.of('A'), attr);
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'alias.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
  });
  it('rejects chained actions even when the first GoTo destination is local', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(
      PDFName.of('OpenAction'),
      pdf.context.obj({
        S: 'GoTo',
        D: [pdf.getPage(0).ref, PDFName.of('Fit')],
        Next: { S: 'JavaScript', JS: PDFString.of('synthetic') },
      }),
    );
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'action.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ message: expect.stringContaining('unsupported actions') });
  });
  it('rejects invalid/non-local OpenAction destinations', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(
      PDFName.of('OpenAction'),
      pdf.context.obj([PDFString.of('external.pdf'), PDFName.of('Fit')]),
    );
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'bad.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
  });
  it('accepts an empty inert AcroForm but rejects unreferenced additional action dictionaries', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [] }));
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'empty.pdf', 'application/pdf'),
    ).resolves.toBeUndefined();
    pdf.context.register(pdf.context.obj({ S: 'Launch', F: PDFString.of('synthetic.exe') }));
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'orphan.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ message: expect.stringContaining('Launch') });
  });
  it('rejects external stream data and executable PostScript XObjects', async () => {
    for (const attributes of [
      { F: PDFString.of('external-image.bin') },
      { Type: PDFName.of('XObject'), Subtype: PDFName.of('PS') },
    ]) {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      pdf.context.register(pdf.context.stream('synthetic', attributes));
      await expect(
        validatePatientFile(Buffer.from(await pdf.save()), 'external.pdf', 'application/pdf'),
      ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
    }
  });
  it('does not allow a destination to refer to a non-page object', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const object = pdf.context.register(pdf.context.obj({ Type: 'Example' }));
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj([object, PDFName.of('Fit')]));
    await expect(
      validatePatientFile(Buffer.from(await pdf.save()), 'wrong.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
  });
});
