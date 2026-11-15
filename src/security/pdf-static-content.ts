import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

/** Feature labels/messages are constants: never echo PDF strings or parser internals. */
export class PdfContentError extends Error {}
const messages = {
  javascript: 'PDF contains JavaScript actions. Export a static PDF without scripts.',
  launch:
    'PDF contains Launch actions that can open programs or files. Export a static PDF without actions.',
  attachments:
    'PDF contains embedded attachments or file specifications. Export a PDF without attachments.',
  forms:
    'PDF contains unsupported interactive form elements. Export a flattened, static PDF from a trusted application.',
  external:
    'PDF contains external actions or externally referenced content. Export a self-contained static PDF without actions.',
  action: 'PDF contains unsupported actions. Export a static PDF without actions.',
  annotation:
    'PDF contains unsupported interactive annotations or multimedia. Export a static PDF without interactive content.',
  postscript: 'PDF contains unsupported executable PostScript content. Export a static PDF.',
  structure: 'PDF could not be safely parsed: unsupported or invalid PDF object structure.',
};
const staticAnnotations = new Set([
  'Text',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
  'Popup',
  'Link',
]);
const actionTypes = new Set([
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
const externalActions = new Set(['URI', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData']);

/** Structural inspection only. No PDF actions, scripts, rendering or rewriting.
 * All parsed objects (also unreferenced objects/object streams) are inspected.
 * /A is not universally an action: Type3 CharProcs and StructElem attributes
 * use that name for ordinary printable content. Those namespaces are narrowly
 * validated before being allowed; an actual action slot still rejects them.
 */
export function inspectStaticPdf(pdf: PDFDocument): void {
  function fail(kind: keyof typeof messages): never {
    throw new PdfContentError(messages[kind]);
  }
  const resolve = (value: PDFObject | undefined): PDFObject | undefined => {
    if (!(value instanceof PDFRef)) return value;
    const resolved = pdf.context.lookup(value);
    if (!resolved) fail('structure');
    return resolved;
  };
  const name = (value: PDFObject | undefined) => {
    const v = resolve(value);
    return v instanceof PDFName ? v.decodeText() : undefined;
  };
  const dicts = new Set<PDFDict>(),
    streams = new Set<PDFStream>(),
    visited = new Set<PDFObject>();
  const collect = (raw: PDFObject | undefined, depth = 0): void => {
    const value = resolve(raw);
    if (!value || visited.has(value)) return;
    if (depth > 128 || visited.size >= 100_000) fail('structure');
    visited.add(value);
    if (value instanceof PDFStream) {
      streams.add(value);
      collect(value.dict, depth + 1);
    } else if (value instanceof PDFDict) {
      dicts.add(value);
      for (const [, v] of value.entries()) collect(v, depth + 1);
    } else if (value instanceof PDFArray) {
      for (const v of value.asArray()) collect(v, depth + 1);
    }
  };
  for (const [, object] of pdf.context.enumerateIndirectObjects()) collect(object);
  collect(pdf.catalog);
  const streamMaps = new Set<PDFDict>();
  const streamMap = (raw: PDFObject | undefined): void => {
    const dict = resolve(raw);
    if (!(dict instanceof PDFDict)) fail('structure');
    for (const [, value] of dict.entries())
      if (!(resolve(value) instanceof PDFStream)) fail('structure');
    streamMaps.add(dict);
  };
  const annotations = new Set<PDFDict>();
  for (const dict of dicts) {
    if (
      name(dict.get(PDFName.of('Type'))) === 'Font' &&
      name(dict.get(PDFName.of('Subtype'))) === 'Type3'
    )
      streamMap(dict.get(PDFName.of('CharProcs')));
    if (name(dict.get(PDFName.of('Type'))) === 'Annot') annotations.add(dict);
  }
  for (const page of pdf.getPages()) {
    const annots = resolve(page.node.get(PDFName.of('Annots')));
    if (!annots || annots === PDFNull) continue;
    if (!(annots instanceof PDFArray)) fail('structure');
    for (const raw of annots.asArray()) {
      const annot = resolve(raw);
      if (!(annot instanceof PDFDict)) fail('structure');
      annotations.add(annot);
    }
  }
  for (const annot of annotations) {
    if (!staticAnnotations.has(name(annot.get(PDFName.of('Subtype'))) ?? '')) {
      if (name(annot.get(PDFName.of('Subtype'))) === 'Widget') fail('forms');
      if (name(annot.get(PDFName.of('Subtype'))) === 'FileAttachment') fail('attachments');
      fail('annotation');
    }
    const ap = resolve(annot.get(PDFName.of('AP')));
    if (ap && ap !== PDFNull) {
      if (!(ap instanceof PDFDict)) fail('structure');
      for (const [key, raw] of ap.entries()) {
        if (!['N', 'R', 'D'].includes(key.decodeText())) fail('structure');
        const value = resolve(raw);
        if (!(value instanceof PDFStream)) streamMap(value);
      }
    }
  }
  const inspectAction = (raw: PDFObject | undefined): void => {
    const value = resolve(raw);
    if (value instanceof PDFDict) {
      const subtype = name(value.get(PDFName.of('S')));
      if (subtype === 'JavaScript' || value.has(PDFName.of('JS'))) fail('javascript');
      if (subtype === 'Launch') fail('launch');
      if (externalActions.has(subtype ?? '')) fail('external');
      if (subtype === 'GoTo') {
        if (value.keys().some((key) => !['Type', 'S', 'D'].includes(key.decodeText())))
          fail('action');
        destination(value.get(PDFName.of('D')));
        return;
      }
    }
    fail('action');
  };
  const destination = (raw: PDFObject | undefined): void => {
    const value = resolve(raw);
    if (!(value instanceof PDFArray)) fail('action');
    const values = value.asArray();
    const page = resolve(values[0]);
    if (!pdf.getPages().some((p) => p.node === page)) fail('structure');
    const view = name(values[1]);
    const arity: Record<string, number> = {
      XYZ: 5,
      Fit: 2,
      FitH: 3,
      FitV: 3,
      FitR: 6,
      FitB: 2,
      FitBH: 3,
      FitBV: 3,
    };
    if (!view || arity[view] !== values.length) fail('structure');
    for (const raw of values.slice(2)) {
      const n = resolve(raw);
      if (n === PDFNull && view !== 'FitR') continue;
      if (!(n instanceof PDFNumber) || !Number.isFinite(n.asNumber())) fail('structure');
    }
  };
  const attributes = (raw: PDFObject | undefined): void => {
    const value = resolve(raw);
    if (value instanceof PDFArray) {
      for (const raw of value.asArray()) {
        const v = resolve(raw);
        if (v instanceof PDFNumber) {
          if (!Number.isSafeInteger(v.asNumber()) || v.asNumber() < 0) fail('structure');
        } else if (!(v instanceof PDFDict) || !name(v.get(PDFName.of('O')))) fail('structure');
      }
    } else if (!(value instanceof PDFDict) || !name(value.get(PDFName.of('O')))) fail('structure');
  };
  for (const stream of streams) {
    if (stream.dict.has(PDFName.of('F'))) fail('external'); // External stream data, not a printable glyph F.
  }
  for (const dict of dicts) {
    const type = name(dict.get(PDFName.of('Type'))),
      subtype = name(dict.get(PDFName.of('Subtype')));
    if (['Filespec', 'EmbeddedFile'].includes(type ?? '')) fail('attachments');
    if (type === 'Action' || actionTypes.has(name(dict.get(PDFName.of('S'))) ?? ''))
      inspectAction(dict);
    if (subtype === 'PS') fail('postscript');
    if (subtype === 'Widget' || dict.has(PDFName.of('FT'))) fail('forms');
    if (['RichMedia', 'Movie', 'Sound', 'Screen', '3D'].includes(subtype ?? '')) fail('annotation');
    if (subtype === 'FileAttachment') fail('attachments');
    for (const [key, raw] of dict.entries()) {
      const k = key.decodeText();
      // These are glyph/appearance state NAMES, never action dictionary keys.
      // Values were checked as streams; their dictionaries are inspected separately.
      if (streamMaps.has(dict)) continue;
      if (k === 'JS' || k === 'JavaScript') fail('javascript');
      if (['EmbeddedFiles', 'EF', 'AF', 'Collection'].includes(k)) fail('attachments');
      if (k === 'XFA' || (k === 'NeedsRendering' && String(resolve(raw)) === 'true')) fail('forms');
      if (k === 'AcroForm') {
        const form = resolve(raw);
        if (!(form instanceof PDFDict)) fail('structure');
        const fields = resolve(form.get(PDFName.of('Fields')));
        if (fields && (!(fields instanceof PDFArray) || fields.size() > 0)) fail('forms');
        if (form.has(PDFName.of('SigFlags'))) fail('forms');
      }
      if (k === 'AA') {
        const aa = resolve(raw);
        if (aa instanceof PDFDict) for (const [, action] of aa.entries()) inspectAction(action);
        fail('action');
      }
      if (k === 'OpenAction') {
        if (resolve(raw) instanceof PDFArray) destination(raw);
        else inspectAction(raw);
      }
      if (k === 'A') {
        if (type === 'StructElem') attributes(raw);
        else inspectAction(raw);
      }
      if (k === 'Dest' && annotations.has(dict)) destination(raw);
      if (
        [
          'RichMedia',
          'RichMediaContent',
          'RichMediaSettings',
          'Movie',
          'Sound',
          '3DD',
          'PresSteps',
        ].includes(k)
      )
        fail('annotation');
      if (k === 'OPI' || (k === 'Ref' && subtype === 'Form')) fail('external');
    }
  }
}
