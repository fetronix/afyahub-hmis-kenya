/**
 * Turning a `DocumentModel` into a PDF, on the facility's letterhead.
 *
 * WHY TWO LIBRARIES
 * -----------------
 * `pdfkit` is already the project's PDF writer: it lays out flowing text, wraps
 * tables and embeds the DejaVu font the report centre uses for Kenyan names and
 * the shilling sign. What it cannot do is start from a PDF the facility
 * supplied. `pdf-lib` reads and re-assembles existing pages. So the work is
 * split honestly:
 *
 *   1. pdfkit writes the *content* — everything the system knows — onto a page
 *      whose margins are exactly the letterhead's body rectangle.
 *   2. pdf-lib composes: the letterhead page is embedded underneath, then the
 *      content page is drawn on top at the same origin.
 *
 * Because step 1 never writes outside its margins and step 2 performs no
 * scaling or reflow, the two cannot overlap by construction. The letterhead is
 * never rasterised or redrawn, so its colours, fonts and vectors are preserved
 * exactly as uploaded.
 *
 * MULTI-PAGE
 * ----------
 * A letterhead PDF with two or more pages is understood as "cover, then
 * continuation": page 1 is used for the first content page and page 2 for every
 * later one. A single-page letterhead is repeated on every page. That is the
 * convention facilities already use for pre-printed stationery, and it needs no
 * configuration.
 *
 * NO LETTERHEAD
 * -------------
 * A facility that has not uploaded one still gets a correct, plain A4 document.
 * Refusing to print an invoice because branding is missing would stop a
 * hospital's cash office; the fallback is deliberate and is reported in the
 * response so an operator knows why the page looks plain.
 */

import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFComposer } from 'pdf-lib';

import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  type DocumentField,
  type DocumentModel,
  type DocumentTable,
} from './document-model.ts';

const require = createRequire(import.meta.url);

/** Resolved lazily so a missing font package cannot stop the server booting. */
function contentFontPath(): string {
  const path = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
  const font = fontkit.openSync(path);
  if (!('hasGlyphForCodePoint' in font)) throw new Error('DOCUMENT_FONT_INVALID');
  return path;
}

function boldFontPath(): string {
  try {
    return require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
  } catch {
    return contentFontPath();
  }
}

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#d1d5db';

/** Space reserved inside the body, below the flow, for the page footer. */
const FOOTER_BAND_PT = 20;

/** Thermal receipt geometry: 80 mm roll, 216 pt of usable width. */
const THERMAL_WIDTH_PT = 226;
const THERMAL_MARGIN_PT = 8;
/** Thermal page height is content-driven; this is the starting estimate. */
const THERMAL_HEIGHT_PT = 900;

export interface LetterheadForRender {
  /** The stored PDF. Absent means the facility has no letterhead. */
  bytes: Buffer | null;
  bodyTopPt: number;
  bodyBottomPt: number;
  bodyLeftPt: number;
  bodyRightPt: number;
  pageWidthPt: number;
  pageHeightPt: number;
  /** E.g. `Version 3 (activated 2026-11-02)`. Shown in the footer. */
  label: string;
}

export interface RenderResult {
  bytes: Buffer;
  pages: number;
  letterheadApplied: boolean;
}

/**
 * Validate the model's column fractions.
 *
 * A table whose columns do not sum to 1 would silently overflow the body and
 * print over the letterhead's margin, so this is an error rather than a
 * correction: the caller is a fixed template, and a wrong template is a bug.
 */
function assertColumns(table: DocumentTable): void {
  const total = table.columns.reduce((sum, column) => sum + column.width, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`DOCUMENT_TABLE_WIDTH_INVALID: columns sum to ${total.toFixed(3)}, expected 1`);
  }
}

interface Layout {
  widthPt: number;
  heightPt: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  thermal: boolean;
}

function layoutFor(model: DocumentModel, letterhead: LetterheadForRender | null): Layout {
  if (model.thermal) {
    return {
      widthPt: THERMAL_WIDTH_PT,
      heightPt: THERMAL_HEIGHT_PT,
      top: THERMAL_MARGIN_PT,
      bottom: THERMAL_MARGIN_PT,
      left: THERMAL_MARGIN_PT,
      right: THERMAL_MARGIN_PT,
      thermal: true,
    };
  }
  const width = letterhead?.pageWidthPt ?? A4_WIDTH_PT;
  const height = letterhead?.pageHeightPt ?? A4_HEIGHT_PT;
  return {
    widthPt: width,
    heightPt: height,
    top: letterhead?.bodyTopPt ?? 56.69,
    bottom: (letterhead?.bodyBottomPt ?? 56.69) + FOOTER_BAND_PT,
    left: letterhead?.bodyLeftPt ?? 48,
    right: letterhead?.bodyRightPt ?? 48,
    thermal: false,
  };
}

/** Write the content pages. Returns the pdfkit-rendered bytes. */
async function renderContent(model: DocumentModel, layout: Layout): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [layout.widthPt, layout.heightPt],
    margins: { top: layout.top, bottom: layout.bottom, left: layout.left, right: layout.right },
    bufferPages: true,
    info: {
      Title: `${model.title} ${model.documentNumber}`,
      Author: model.facility.name,
      Subject: model.title,
      Creator: 'JaliCare HMIS',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const regular = contentFontPath();
  const bold = boldFontPath();
  doc.registerFont('body', regular);
  doc.registerFont('strong', bold);
  doc.font('body');

  const contentWidth = layout.widthPt - layout.left - layout.right;
  const bodyBottomY = layout.heightPt - layout.bottom;
  const small = layout.thermal ? 7 : 8.5;
  const base = layout.thermal ? 8 : 9.5;

  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bodyBottomY) doc.addPage();
  };

  /* ---- Heading ------------------------------------------------------- */
  doc
    .fillColor(INK)
    .font('strong')
    .fontSize(layout.thermal ? 11 : 17)
    .text(model.title);
  if (model.subtitle) {
    doc.font('body').fontSize(base).fillColor(MUTED).text(model.subtitle);
  }
  doc.moveDown(0.35);
  doc
    .font('body')
    .fontSize(base)
    .fillColor(INK)
    .text(
      `${model.facility.name}${model.facility.registryCode ? ` · ${model.facility.registryCode}` : ''}`,
    );
  const addressLine = [model.facility.address, model.facility.county]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
  if (addressLine) doc.fontSize(small).fillColor(MUTED).text(addressLine);
  const contactLine = [model.facility.phone, model.facility.email]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
  if (contactLine) doc.fontSize(small).fillColor(MUTED).text(contactLine);

  doc.moveDown(0.6);

  /* ---- Identity block ------------------------------------------------ */
  /*
   * Two columns of label/value pairs. Everything is drawn at explicit
   * coordinates and the height of each value is measured before the next row
   * is placed: pdfkit's flow cursor is convenient for prose but it silently
   * runs past the bottom margin for blocks like this, and a value that lands
   * outside the body rectangle would print over the letterhead.
   */
  const drawFields = (
    fields: DocumentField[],
    x: number,
    startY: number,
    width: number,
  ): number => {
    let y = startY;
    for (const field of fields) {
      const labelWidth = Math.min(110, width * 0.42);
      const valueWidth = Math.max(40, width - labelWidth);
      doc.font('body').fontSize(small).fillColor(MUTED);
      const labelHeight = doc.heightOfString(field.label, { width: labelWidth });
      doc.text(field.label, x, y, { width: labelWidth });
      doc.font('body').fontSize(base).fillColor(INK);
      const valueHeight = doc.heightOfString(field.value, { width: valueWidth });
      doc.text(field.value, x + labelWidth, y, { width: valueWidth });
      y += Math.max(labelHeight, valueHeight) + 3;
    }
    doc.x = x;
    return y;
  };

  if (model.leftFields.length > 0 || model.rightFields.length > 0) {
    const startY = doc.y;
    let endY: number;
    if (layout.thermal || model.rightFields.length === 0) {
      endY = drawFields(model.leftFields, layout.left, startY, contentWidth);
      doc.y = endY;
    } else {
      const columnWidth = contentWidth / 2 - 10;
      const leftEnd = drawFields(model.leftFields, layout.left, startY, columnWidth);
      const rightEnd = drawFields(
        model.rightFields,
        layout.left + contentWidth / 2 + 10,
        startY,
        columnWidth,
      );
      doc.y = Math.max(leftEnd, rightEnd);
      doc.x = layout.left;
    }
    doc.moveDown(0.5);
  }

  /* ---- Table --------------------------------------------------------- */
  if (model.table) {
    const table = model.table;
    assertColumns(table);
    const padX = 4;
    const padY = 3;

    const columnX = (): number[] => {
      const xs: number[] = [layout.left];
      let running = layout.left;
      for (const column of table.columns) {
        running += column.width * contentWidth;
        xs.push(running);
      }
      return xs;
    };
    const xs = columnX();

    const drawHeader = () => {
      const y = doc.y;
      doc.font('strong').fontSize(small).fillColor(INK);
      table.columns.forEach((column, index) => {
        const width = column.width * contentWidth - padX * 2;
        doc.text(column.label, xs[index] + padX, y, {
          width,
          align: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
          lineBreak: true,
        });
      });
      const headerBottom = Math.max(doc.y, y + small + padY);
      doc
        .moveTo(layout.left, headerBottom + 1)
        .lineTo(layout.left + contentWidth, headerBottom + 1)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();
      doc.y = headerBottom + padY + 1;
      doc.x = layout.left;
    };

    drawHeader();

    for (const row of table.rows) {
      // Measure the row before placing it so it is never split across a page.
      const heights = table.columns.map((column, index) => {
        doc.font('body').fontSize(small);
        return doc.heightOfString(row[index] ?? '', {
          width: column.width * contentWidth - padX * 2,
        });
      });
      const rowHeight = Math.max(...heights) + padY * 2;
      if (doc.y + rowHeight > bodyBottomY) {
        doc.addPage();
        if (table.repeatHeader !== false) drawHeader();
      }
      const y = doc.y;
      doc.font('body').fontSize(small).fillColor(INK);
      table.columns.forEach((column, index) => {
        doc.text(row[index] ?? '', xs[index] + padX, y, {
          width: column.width * contentWidth - padX * 2,
          align: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
        });
      });
      doc.y = y + rowHeight;
      doc.x = layout.left;
    }

    doc.moveDown(0.5);
  }

  /* ---- Prose sections ------------------------------------------------ */
  for (const section of model.sections ?? []) {
    ensureSpace(40);
    doc.moveDown(0.3);
    doc.font('strong').fontSize(base).fillColor(INK).text(section.heading);
    doc.font('body').fontSize(base).fillColor(INK).text(section.body, { align: 'left' });
    doc.moveDown(0.3);
  }

  /* ---- Totals -------------------------------------------------------- */
  if (model.totals && model.totals.length > 0) {
    const width = layout.thermal ? contentWidth : Math.min(contentWidth, 240);
    const x = layout.left + contentWidth - width;

    model.totals.forEach((total, index) => {
      if (total.emphasis && index > 0) {
        doc
          .moveTo(x, doc.y + 2)
          .lineTo(x + width, doc.y + 2)
          .lineWidth(0.6)
          .strokeColor(RULE)
          .stroke();
        doc.y += 5;
      }
      const y = doc.y;
      doc
        .font(total.emphasis ? 'strong' : 'body')
        .fontSize(total.emphasis ? base + 1 : base)
        .fillColor(INK)
        .text(total.label, x, y, { width: width - 90, lineBreak: false });
      doc
        .font(total.emphasis ? 'strong' : 'body')
        .fontSize(total.emphasis ? base + 1 : base)
        .fillColor(INK)
        .text(total.value, x + width - 90, y, { width: 90, align: 'right', lineBreak: false });
      doc.y = y + base + 3;
      doc.x = layout.left;
    });
    doc.moveDown(0.4);
  }

  /* ---- Notes --------------------------------------------------------- */
  if (model.notes && model.notes.length > 0) {
    doc.moveDown(0.2);
    for (const note of model.notes) {
      ensureSpace(24);
      doc.font('body').fontSize(small).fillColor(MUTED).text(note, { align: 'left' });
    }
  }

  /* ---- Footer on every page ------------------------------------------ */
  const footerParts = [model.documentNumber];
  if (model.brandingNote) footerParts.push(model.brandingNote);
  footerParts.push('Generated by JaliCare HMIS');

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const page = doc.page;
    /*
     * The footer sits inside the body's reserved band, below the flow. pdfkit
     * would treat a y past the bottom margin as "start a new page", so the
     * margin is lifted for the duration of the stamp and restored immediately.
     */
    const previousBottom = page.margins.bottom;
    page.margins.bottom = 0;
    const footerY = layout.heightPt - layout.bottom + 6;
    doc
      .font('body')
      .fontSize(layout.thermal ? 6 : 7)
      .fillColor(MUTED)
      .text(footerParts.join(' · '), layout.left, footerY, {
        width: contentWidth * 0.78,
        lineBreak: false,
      });
    doc.text(`Page ${index + 1} of ${range.count}`, layout.left + contentWidth * 0.78, footerY, {
      width: contentWidth * 0.22,
      align: 'right',
      lineBreak: false,
    });
    page.margins.bottom = previousBottom;
  }

  doc.end();
  return done;
}

/**
 * Compose the final document.
 *
 * `letterhead` is what the caller resolved — the active version for a new
 * document, or the version recorded at finalization for a reprint.
 */
export async function renderDocument(
  model: DocumentModel,
  letterhead: LetterheadForRender | null,
): Promise<RenderResult> {
  const layout = layoutFor(model, letterhead);
  const contentBytes = await renderContent(model, layout);

  // The thermal roll cannot carry a letterhead: it is 80 mm wide and the
  // branding is A4. Printing one is not a fallback the operator could use.
  const applied = Boolean(letterhead?.bytes) && !model.thermal;
  if (!applied) {
    const content = await PDFComposer.load(contentBytes, { updateMetadata: false });
    return { bytes: contentBytes, pages: content.getPageCount(), letterheadApplied: false };
  }

  const letterheadDoc = await PDFComposer.load(letterhead!.bytes!, { updateMetadata: false });
  const content = await PDFComposer.load(contentBytes, { updateMetadata: false });
  const output = await PDFComposer.create();

  output.setTitle(`${model.title} ${model.documentNumber}`);
  output.setAuthor(model.facility.name);
  output.setSubject(model.title);
  output.setCreator('JaliCare HMIS');

  const letterheadPages = letterheadDoc.getPages();
  const contentPages = content.getPages();

  /*
   * A letterhead with more than one page is "cover, then continuation": page 1
   * for the first content page and page 2 for every later one. A single-page
   * letterhead repeats. This is the convention of pre-printed stationery and
   * needs no per-facility configuration.
   */
  const continuationIndex = letterheadPages.length > 1 ? 1 : 0;

  /*
   * Embed each source page once and reuse it. Calling `embedPage` per output
   * page would copy the letterhead's images and fonts into the file once per
   * page: a four-page invoice on a scanned letterhead grew to 723 KB, and the
   * same document with the pages embedded once is a fraction of that.
   */
  const embeddedLetterhead = await Promise.all(
    letterheadPages.map((page) => output.embedPage(page)),
  );
  const embeddedContent = await Promise.all(contentPages.map((page) => output.embedPage(page)));

  for (let index = 0; index < contentPages.length; index += 1) {
    const target = await output.addPage([layout.widthPt, layout.heightPt]);
    const letterheadPage = embeddedLetterhead[index === 0 ? 0 : continuationIndex];

    target.drawPage(letterheadPage, {
      x: 0,
      y: 0,
      width: layout.widthPt,
      height: layout.heightPt,
    });
    target.drawPage(embeddedContent[index], {
      x: 0,
      y: 0,
      width: layout.widthPt,
      height: layout.heightPt,
    });
  }

  const bytes = Buffer.from(await output.save());
  return { bytes, pages: contentPages.length, letterheadApplied: true };
}
