import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from 'pdf-lib';
import { inspectStaticPdf } from './pdf-static-content.ts';

export class PdfPreviewError extends Error {
  constructor() {
    super(
      'A safe static PDF preview could not be generated. The original is unchanged and remains available for authorized download.',
    );
  }
}

const actionNames = new Set([
  'GoTo',
  'GoToR',
  'GoToE',
  'Launch',
  'Thread',
  'URI',
  'Sound',
  'Movie',
  'Hide',
  'Named',
  'SubmitForm',
  'ResetForm',
  'ImportData',
  'JavaScript',
  'SetOCGState',
  'Rendition',
  'Trans',
  'GoTo3DView',
]);

function isActionDictionary(dict: PDFDict): boolean {
  const type = dict.get(PDFName.of('Type')),
    s = dict.get(PDFName.of('S'));
  return (
    (type instanceof PDFName && type.decodeText() === 'Action') ||
    (s instanceof PDFName && actionNames.has(s.decodeText()))
  );
}

/** In-memory, ephemeral derivative only. Never writes to storage or changes the input.
 * Validate BEFORE deriving: this is not a way to strip and accept unsafe uploads.
 * No renderer, URL fetch, script engine or PDF action is invoked here.
 */
export async function staticPdfPreview(
  original: Uint8Array,
): Promise<{ bytes: Uint8Array; derived: boolean }> {
  try {
    const pdf = await PDFDocument.load(original, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new PdfPreviewError();
    inspectStaticPdf(pdf);
    let changed = false;
    for (const page of pdf.getPages()) {
      const annots = pdf.context.lookup(page.node.get(PDFName.of('Annots')));
      if (!(annots instanceof PDFArray)) continue;
      for (const raw of annots.asArray()) {
        const annot = pdf.context.lookup(raw);
        if (!(annot instanceof PDFDict) || String(annot.get(PDFName.of('Subtype'))) !== '/Link')
          continue;
        for (const key of ['A', 'Dest']) {
          if (annot.has(PDFName.of(key))) {
            annot.delete(PDFName.of(key));
            changed = true;
          }
        }
      }
    }
    if (pdf.catalog.has(PDFName.of('OpenAction'))) {
      pdf.catalog.delete(PDFName.of('OpenAction'));
      changed = true;
    }
    if (!changed) return { bytes: original, derived: false };

    // Detach now-orphaned indirect action dictionaries. The original validator
    // scans unreferenced objects too, so leaving them in the derivative would
    // fail its post-derivation check. Only objects unreachable from the catalog
    // are deleted; visible artwork and page resources are untouched.
    const indirect = [...pdf.context.enumerateIndirectObjects()];
    const actionRefs = new Map<string, PDFRef>();
    for (const [ref, obj] of indirect)
      if (obj instanceof PDFDict && isActionDictionary(obj)) actionRefs.set(ref.toString(), ref);
    const reachable = new Set<string>(),
      visited = new Set<PDFObject>();
    const walk = (raw: PDFObject | undefined, depth = 0): void => {
      if (!raw || depth > 128 || visited.size > 100_000) throw new PdfPreviewError();
      if (raw instanceof PDFRef) {
        const key = raw.toString();
        if (reachable.has(key)) return;
        reachable.add(key);
        const resolved = pdf.context.lookup(raw);
        if (!resolved) throw new PdfPreviewError();
        walk(resolved, depth + 1);
        return;
      }
      if (visited.has(raw)) return;
      visited.add(raw);
      if (raw instanceof PDFStream) walk(raw.dict, depth + 1);
      else if (raw instanceof PDFDict)
        for (const [, value] of raw.entries()) walk(value, depth + 1);
      else if (raw instanceof PDFArray) for (const value of raw.asArray()) walk(value, depth + 1);
    };
    walk(pdf.catalog);
    for (const [key, ref] of actionRefs) if (!reachable.has(key)) pdf.context.delete(ref);

    pdf.setTitle('Derived static preview — not the original signed document');
    pdf.setSubject(
      'Navigation actions removed for preview only. Download the unchanged original for custody.',
    );
    const bytes = await pdf.save({ addDefaultPage: false });
    const verified = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    inspectStaticPdf(verified);
    if (verified.getPageCount() !== pdf.getPageCount()) throw new PdfPreviewError();
    return { bytes, derived: true };
  } catch {
    throw new PdfPreviewError();
  }
}
