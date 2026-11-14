import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import sharp from 'sharp';

export class PatientDocumentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function documentLimit(): number {
  const value = Number(process.env.PATIENT_DOCUMENT_MAX_BYTES ?? 8 * 1024 * 1024);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 32 * 1024 * 1024)
    throw new Error('PATIENT_DOCUMENT_MAX_BYTES must be 1024–33554432');
  return value;
}
export function insist(value: unknown, code: string, message: string, status = 400): asserts value {
  if (!value) throw new PatientDocumentError(code, message, status);
}

/** Inspect but never rewrite the original. Not malware scanning or signature authentication. */
export async function validatePatientFile(bytes: Buffer, filename: string, mime: string) {
  insist(bytes.length > 0, 'EMPTY_DOCUMENT', 'Choose a nonempty document.');
  insist(
    bytes.length <= documentLimit(),
    'DOCUMENT_TOO_LARGE',
    'Document exceeds configured size limit.',
    413,
  );
  insist(
    filename.length <= 180 &&
      !/[/\\]/.test(filename) &&
      !Array.from(filename).some((char) => char.charCodeAt(0) < 32),
    'INVALID_FILENAME',
    'Use a plain filename.',
  );
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  insist(
    ext && types[ext] === mime,
    'UNSUPPORTED_DOCUMENT',
    'Only matching PDF, JPG, JPEG and PNG files are supported. DOCX preview is not supported.',
  );
  try {
    if (mime === 'application/pdf') {
      insist(
        bytes.subarray(0, 5).toString() === '%PDF-' &&
          /%%EOF\s*$/.test(bytes.subarray(-2048).toString('latin1')),
        'INVALID_PDF',
        'A complete PDF is required.',
      );
      const pdf = await PDFDocument.load(bytes, {
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      insist(
        pdf.getPageCount() > 0 && pdf.getPageCount() <= 100,
        'INVALID_PDF',
        'PDF must contain 1–100 pages.',
      );
      // Walk parsed dictionaries, including decoded object streams and escaped PDF names.
      const forbidden = new Set([
        'JS',
        'JavaScript',
        'AA',
        'OpenAction',
        'A',
        'EmbeddedFiles',
        'EF',
        'XFA',
        'RichMedia',
        'Collection',
      ]);
      const visited = new Set<unknown>();
      const walk = (obj: unknown) => {
        if (!obj || visited.has(obj)) return;
        visited.add(obj);
        if (obj instanceof PDFStream) walk(obj.dict);
        if (obj instanceof PDFDict)
          for (const [key, value] of obj.entries()) {
            insist(
              !forbidden.has(key.decodeText()),
              'UNSAFE_PDF',
              'Active content, actions and embedded attachments are not supported.',
            );
            if (value instanceof PDFName)
              insist(
                !['Filespec', 'EmbeddedFile'].includes(value.decodeText()),
                'UNSAFE_PDF',
                'Embedded files are not supported.',
              );
            walk(value);
          }
        if (obj instanceof PDFArray) obj.asArray().forEach(walk);
      };
      pdf.context.enumerateIndirectObjects().forEach(([, obj]) => walk(obj));
      for (const page of pdf.getPages())
        insist(
          page.getWidth() > 0 &&
            page.getWidth() <= 3000 &&
            page.getHeight() > 0 &&
            page.getHeight() <= 3000,
          'INVALID_PDF',
          'PDF page geometry is unsupported.',
        );
    } else {
      const image = sharp(bytes, {
        limitInputPixels: 25_000_000,
        failOn: 'warning',
        animated: false,
      });
      const meta = await image.metadata();
      insist(
        meta.format === (mime === 'image/png' ? 'png' : 'jpeg') && (meta.pages ?? 1) === 1,
        'INVALID_IMAGE',
        'A single matching PNG or JPEG image is required.',
      );
      await image.raw().toBuffer(); // Decode the image; a magic header alone is not validation.
    }
  } catch (error) {
    if (error instanceof PatientDocumentError) throw error;
    throw new PatientDocumentError(
      'MALFORMED_DOCUMENT',
      'Document cannot be decoded safely; re-export a standard PDF or image.',
    );
  }
}
