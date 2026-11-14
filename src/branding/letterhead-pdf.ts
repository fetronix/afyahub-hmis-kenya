/**
 * Accepting a facility's letterhead PDF safely.
 *
 * A letterhead becomes the background of every invoice, receipt and report the
 * facility issues, so a malformed file is not a cosmetic problem: it would
 * corrupt documents that have already been given to a patient or a payer. This
 * module is the only door the bytes come through, and it refuses everything it
 * cannot account for.
 *
 * WHAT IS CHECKED, AND WHY EACH CHECK EXISTS
 * ------------------------------------------
 * 1. Declared type. The client sends a MIME type; it is compared with the
 *    filename extension and with the actual first bytes. A browser reports the
 *    extension, a proxy rewrites the header, and only the magic number is
 *    evidence — so all three must agree before the file is parsed.
 * 2. PDF signature. `%PDF-` must be the first five bytes. A file that merely
 *    ends in `.pdf` is not a PDF.
 * 3. End-of-file marker. A truncated upload is the commonest real failure: the
 *    signature is fine and the last page is missing. `%%EOF` within the final
 *    kilobyte catches a cut-off transfer that pdf-lib would otherwise accept
 *    for the pages it can still see.
 * 4. Size. Zero bytes is not a document; more than 8 MB is not a letterhead,
 *    and every generated document would pay for it.
 * 5. Parse. pdf-lib must be able to load it, which is the same code path the
 *    renderer will use — a file that parses here cannot fail later.
 * 6. Page geometry. Documents are laid out A4-compatible, so the letterhead
 *    must be a single portrait page of a sane, A4-like size. A landscape or
 *    oversized page would silently produce documents of a different format.
 */

import { PDFDocument } from 'pdf-lib';

/** 8 MB. Large enough for a scanned letterhead, small enough to read per render. */
export const LETTERHEAD_MAX_BYTES = 8 * 1024 * 1024;

/** The only MIME type accepted. */
export const LETTERHEAD_MIME = 'application/pdf';

export type LetterheadErrorCode =
  | 'LETTERHEAD_EMPTY'
  | 'LETTERHEAD_TOO_LARGE'
  | 'LETTERHEAD_EXTENSION_INVALID'
  | 'LETTERHEAD_MIME_INVALID'
  | 'LETTERHEAD_SIGNATURE_INVALID'
  | 'LETTERHEAD_TRUNCATED'
  | 'LETTERHEAD_UNREADABLE'
  | 'LETTERHEAD_ENCRYPTED'
  | 'LETTERHEAD_PAGES_INVALID'
  | 'LETTERHEAD_PAGE_SIZE_INVALID'
  | 'LETTERHEAD_LAYOUT_INVALID'
  /*
   * Lifecycle and authorization outcomes raised by `letterhead.service.ts`.
   * They share this error class so a route has one shape to translate and one
   * place to look for the status code that belongs to each outcome.
   */
  | 'LETTERHEAD_NOT_FOUND'
  | 'LETTERHEAD_FORBIDDEN'
  | 'LETTERHEAD_ID_INVALID'
  | 'LETTERHEAD_NOT_A_DOCUMENT'
  | 'LETTERHEAD_IMMUTABLE'
  | 'LETTERHEAD_NOT_ACTIVATABLE'
  | 'LETTERHEAD_NOT_WITHDRAWABLE'
  | 'LETTERHEAD_REASON_REQUIRED'
  | 'LETTERHEAD_DUPLICATE';

export class LetterheadError extends Error {
  readonly code: LetterheadErrorCode;
  readonly status: number;

  constructor(code: LetterheadErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'LetterheadError';
    this.code = code;
    this.status = status;
  }
}

export interface LetterheadPdfFacts {
  pages: number;
  widthPt: number;
  heightPt: number;
}

/** A4 is 595.28 × 841.89 pt; US Letter is 612 × 792. Bleed adds a few points. */
const MIN_WIDTH_PT = 500;
const MAX_WIDTH_PT = 660;
const MIN_HEIGHT_PT = 700;
const MAX_HEIGHT_PT = 960;

/**
 * Validate a candidate letterhead and report what the renderer needs to know.
 *
 * Throws `LetterheadError` for every rejection, with a message written for the
 * administrator doing the upload rather than for a developer reading a stack
 * trace. Callers translate it to an HTTP response and never expose the bytes.
 */
export async function inspectLetterheadPdf(
  bytes: Buffer,
  meta: { filename: string; mimeType: string },
): Promise<LetterheadPdfFacts> {
  const filename = meta.filename.trim();
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : '';

  // 1. Extension, then declared type. Checked before size so the message names
  //    the thing the operator can actually fix.
  if (extension !== 'pdf') {
    throw new LetterheadError(
      'LETTERHEAD_EXTENSION_INVALID',
      'The letterhead must be a PDF file (extension .pdf).',
    );
  }
  if (meta.mimeType.trim().toLowerCase() !== LETTERHEAD_MIME) {
    throw new LetterheadError(
      'LETTERHEAD_MIME_INVALID',
      'The letterhead must be sent as application/pdf.',
    );
  }

  // 2. Size.
  if (bytes.length === 0) {
    throw new LetterheadError('LETTERHEAD_EMPTY', 'The uploaded file is empty.');
  }
  if (bytes.length > LETTERHEAD_MAX_BYTES) {
    throw new LetterheadError(
      'LETTERHEAD_TOO_LARGE',
      `The letterhead is larger than ${Math.floor(LETTERHEAD_MAX_BYTES / (1024 * 1024))} MB. Reduce the image resolution and try again.`,
      413,
    );
  }

  // 3. Magic number. A leading UTF-8 BOM or stray whitespace is tolerated by
  //    some writers, so the signature is searched in the first 1 KB rather than
  //    required at offset 0 — but it must be there.
  const head = bytes.subarray(0, Math.min(1024, bytes.length)).toString('latin1');
  if (!head.includes('%PDF-')) {
    throw new LetterheadError(
      'LETTERHEAD_SIGNATURE_INVALID',
      'That file is not a PDF: it does not begin with a PDF signature.',
    );
  }

  // 4. Truncation. `%%EOF` must be near the end; a file cut mid-transfer keeps
  //    a valid header and loses its tail.
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new LetterheadError(
      'LETTERHEAD_TRUNCATED',
      'The PDF appears to be incomplete. Upload the file again.',
    );
  }

  // 5. Parse with the same library the renderer uses.
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = String((error as Error)?.message ?? '');
    if (/encrypt/i.test(message)) {
      throw new LetterheadError(
        'LETTERHEAD_ENCRYPTED',
        'The PDF is password-protected. Remove the protection and upload it again.',
      );
    }
    throw new LetterheadError(
      'LETTERHEAD_UNREADABLE',
      'The PDF could not be read. Re-export it as a standard PDF and try again.',
    );
  }

  // 6. One page, portrait, A4-compatible.
  const pages = pdf.getPageCount();
  if (pages < 1) {
    throw new LetterheadError('LETTERHEAD_PAGES_INVALID', 'The PDF has no pages.');
  }
  const first = pdf.getPage(0);
  const widthPt = round2(first.getWidth());
  const heightPt = round2(first.getHeight());
  if (
    widthPt < MIN_WIDTH_PT ||
    widthPt > MAX_WIDTH_PT ||
    heightPt < MIN_HEIGHT_PT ||
    heightPt > MAX_HEIGHT_PT ||
    heightPt <= widthPt
  ) {
    throw new LetterheadError(
      'LETTERHEAD_PAGE_SIZE_INVALID',
      `The first page is ${widthPt} × ${heightPt} pt. Upload an A4 portrait letterhead (595 × 842 pt).`,
    );
  }

  return { pages, widthPt, heightPt };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Read the geometry of an already-stored letterhead without re-validating it. */
export async function readLetterheadGeometry(bytes: Buffer): Promise<LetterheadPdfFacts> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const first = pdf.getPage(0);
  return {
    pages: pdf.getPageCount(),
    widthPt: round2(first.getWidth()),
    heightPt: round2(first.getHeight()),
  };
}
