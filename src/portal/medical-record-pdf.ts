/**
 * Syrona Medical Center HMIS
 * Patient portal — the medical record PDF
 *
 * WHAT THIS FILE IS, AND IS NOT
 * -----------------------------
 * It is a renderer. It receives `PortalMedicalRecord` — already assembled from
 * the patient's own session by `buildPortalMedicalRecord` — and prints it. It
 * opens no database connection, reads no patient id and cannot widen the set of
 * data the service authorised.
 *
 * LAYOUT
 * ------
 * A4, or the page size of the facility's active letterhead, laid out inside the
 * body rectangle `letterheadContentFrame` measures. The facility header (name,
 * registry code, address, contacts) is written on every page by this file, so a
 * record remains identifiable on page 7 of a long history and when the facility
 * has no letterhead at all. The letterhead itself is composed underneath by the
 * same function every other document uses.
 *
 * PAGINATION
 * ----------
 * pdfkit will happily start a new page in the middle of a paragraph, and it
 * knows nothing about our header: the text would print over it. Every block
 * here is therefore measured first and split at a word boundary only when it
 * cannot fit, so a page break is always something this file decided. "Page X of
 * Y" is stamped after the content is complete, when Y is known.
 */

import PDFDocument from 'pdfkit';
import { PDFDocument as PDFComposer } from 'pdf-lib';

import {
  boldFontPath,
  composeOnLetterhead,
  contentFontPath,
  letterheadContentFrame,
  type LetterheadForRender,
} from '../documents/render.ts';

import type { PortalMedicalRecord } from './portal-records.service.ts';

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#d1d5db';
const ACCENT = '#0f766e';
const SOFT = '#f8fafc';

const DEFAULT_TIMEZONE = 'Africa/Nairobi';

const BODY = 9.5;
const SMALL = 8.5;
const TINY = 7.5;
const TABLE = 8;
const LINE_GAP = 1.4;

export interface MedicalRecordPdfResult {
  bytes: Buffer;
  pages: number;
  letterheadApplied: boolean;
}

/* ============================================================
   Dates
   ============================================================ */

/**
 * A date-only column (`2026-03-12`) is a calendar day, not an instant. Parsing
 * it as UTC midnight and formatting it in Nairobi would move it three hours
 * forward — still the same day, but parsing `2026-03-12` as local midnight in a
 * UTC process and formatting it in Nairobi does not, and one wrong day in a
 * discharge date is a factual error in a medical record. Date-only values are
 * therefore formatted from their own parts.
 */
function formatDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatDateOnlyShort(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const dateTime = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const timeOnly = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

const wallClockDate = (parts: { year: number; month: number; day: number }): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));

/**
 * A stored wall-clock timestamp, formatted as stored.
 *
 * Clinical timestamps in this database are `timestamp without time zone`: 09:15
 * in the column means 09:15 at the facility. There is no offset to convert, and
 * converting one would change the recorded time. The renderer therefore prints
 * the same reading the clinician entered, whatever the server process's own
 * timezone happens to be — the failure mode the previous JSON export avoided
 * only because it exposed the raw instant.
 */
function formatWallClock(
  value: string | Date,
): { date: string; time: string | null } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      date: wallClockDate({
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
      }),
      time: `${String(value.getUTCHours()).padStart(2, '0')}:${String(
        value.getUTCMinutes(),
      ).padStart(2, '0')}`,
    };
  }

  const naive = WALL_CLOCK.exec(value.trim());
  if (naive) {
    return {
      date: wallClockDate({
        year: Number(naive[1]),
        month: Number(naive[2]),
        day: Number(naive[3]),
      }),
      time: `${naive[4]}:${naive[5]}`,
    };
  }

  return null;
}

/**
 * “12 March 2026” for a date, “12 March 2026, 09:15” for a stored timestamp.
 *
 * Values carrying an explicit offset (`Z`, `+03:00`) are true instants — the
 * generation stamp is one — and those are rendered in the facility's timezone.
 */
export function formatRecordDate(
  value: string | Date | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';

  if (typeof value === 'string') {
    const dateOnly = formatDateOnly(value);
    if (dateOnly) return dateOnly;
  }

  const wall = formatWallClock(value);
  if (wall) return wall.date;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTime(timezone).format(date);
}

export function formatRecordDateTime(
  value: string | Date | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';

  if (typeof value === 'string') {
    const dateOnly = formatDateOnly(value);
    if (dateOnly) return dateOnly;
  }

  const wall = formatWallClock(value);
  if (wall) return wall.time ? `${wall.date} at ${wall.time}` : wall.date;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTime(timezone).format(date);
}

/**
 * The real instant a scheduled time names, for deciding “upcoming” or “past”.
 * A wall-clock string is interpreted in the facility's zone rather than the
 * process's, so the comparison is the same on a UTC build server.
 */
export function zonedInstant(value: string, timezone: string = DEFAULT_TIMEZONE): number {
  const naive = WALL_CLOCK.exec(value.trim());
  if (!naive) return Date.parse(value);

  const guess = Date.UTC(
    Number(naive[1]),
    Number(naive[2]) - 1,
    Number(naive[3]),
    Number(naive[4]),
    Number(naive[5]),
    Number(naive[6] ?? 0),
  );
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return guess - (asUtc - guess);
}

/**
 * “27 October 2026 at 14:32 (Africa/Nairobi)” — the generation stamp.
 *
 * Unlike a stored clinical timestamp this is a true instant (`new Date()`), so
 * it is rendered in the facility's timezone and the zone is named, which is
 * what makes the stamp unambiguous when the file is printed elsewhere.
 */
export function formatGeneratedAt(
  value: string | Date,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${dateTime(timezone).format(date)} (${timezone})`;
}

/** `2026-10-27` in Nairobi, for the file name, not the UTC day. */
export function localDateStamp(value: Date, timezone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/* ============================================================
   Wording
   ============================================================ */

const TITLE_CASE = new Map([
  ['ACTIVE', 'Active'],
  ['COMPLETED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
  ['ON_HOLD', 'On hold'],
  ['PLANNED', 'Planned'],
  ['OUTPATIENT', 'Outpatient (OPD)'],
  ['INPATIENT', 'Inpatient'],
  ['EMERGENCY', 'Emergency'],
  ['ANC', 'Antenatal care'],
  ['MATERNITY', 'Maternity'],
  ['SPECIALIST', 'Specialist clinic'],
  ['TELEMEDICINE', 'Telemedicine'],
  ['FOLLOW_UP', 'Follow-up'],
]);

/** Known values are given a readable label; anything else is printed as stored. */
function label(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  return TITLE_CASE.get(value) ?? value;
}

function lowerLabel(value: string | null | undefined): string {
  if (!value) return 'not recorded';
  return TITLE_CASE.get(value)?.toLowerCase() ?? value.toLowerCase();
}

function allergyTypeLabel(value: string): string {
  switch (value) {
    case 'DRUG':
      return 'Medicine';
    case 'FOOD':
      return 'Food';
    case 'ENVIRONMENTAL':
      return 'Environmental';
    case 'OTHER':
      return 'Other';
    default:
      return value;
  }
}

const NO_ALLERGY_TEXT = /^(none|nil|no known allergies|no known drug allergies|nka|nkda|n\/a)\.?$/i;

/* ============================================================
   Renderer
   ============================================================ */

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export async function renderMedicalRecordPdf(
  record: PortalMedicalRecord,
  letterhead: LetterheadForRender | null,
): Promise<MedicalRecordPdfResult> {
  const frame = letterheadContentFrame(letterhead);
  const { widthPt, heightPt, top, bottom, left, right } = frame;
  const contentWidth = widthPt - left - right;
  const bodyBottomY = heightPt - bottom;

  const doc = new PDFDocument({
    size: [widthPt, heightPt],
    margins: { top, bottom, left, right },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: 'Patient Medical Record',
      Author: record.facility.name,
      Subject: 'Patient medical record',
      Creator: 'Syrona Medical Center HMIS',
    },
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.registerFont('body', contentFontPath());
  doc.registerFont('strong', boldFontPath());
  doc.font('body');

  const timezone = record.timezone || DEFAULT_TIMEZONE;
  const patientName = [record.patient.firstName, record.patient.middleName, record.patient.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');
  const generated = formatGeneratedAt(record.generatedAt, timezone);

  /* ---------- header / footer ---------- */

  const drawHeader = () => {
    const facility = record.facility;
    const nameWidth = contentWidth - 150;
    doc.font('strong').fontSize(11.5).fillColor(INK);
    const nameHeight = doc.heightOfString(facility.name, { width: nameWidth });
    doc.text(facility.name, left, top, { width: nameWidth });

    doc.font('body').fontSize(TINY).fillColor(MUTED);
    doc.text('PATIENT MEDICAL RECORD', left + contentWidth - 150, top + 1, {
      width: 150,
      align: 'right',
      lineBreak: false,
    });

    const identity = [
      facility.registryCode ? `MFL ${facility.registryCode}` : null,
      facility.code ? `Facility code ${facility.code}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ');

    const address = [facility.address, facility.subCounty, facility.county]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(', ');
    const contact = [facility.phone, facility.email]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' · ');

    let y = top + Math.max(nameHeight, 13) + 1;
    for (const line of [identity, address, contact]) {
      if (!line) continue;
      doc.font('body').fontSize(TINY).fillColor(MUTED);
      const height = doc.heightOfString(line, { width: contentWidth });
      doc.text(line, left, y, { width: contentWidth });
      y += height + 0.5;
    }

    doc
      .moveTo(left, y + 3)
      .lineTo(left + contentWidth, y + 3)
      .lineWidth(0.8)
      .strokeColor(RULE)
      .stroke();

    doc.x = left;
    doc.y = y + 10;
  };

  const newPage = () => {
    doc.addPage();
    doc.x = left;
    doc.y = top;
    drawHeader();
  };

  /* ---------- text helpers ---------- */

  const paragraph = (
    value: string,
    options: {
      size?: number;
      color?: string;
      font?: 'body' | 'strong';
      width?: number;
      x?: number;
      lineGap?: number;
      spaceAfter?: number;
    } = {},
  ): void => {
    const text = String(value ?? '').trim();
    if (!text) return;

    const size = options.size ?? BODY;
    const width = options.width ?? contentWidth;
    const x = options.x ?? left;
    const lineGap = options.lineGap ?? LINE_GAP;
    const spaceAfter = options.spaceAfter ?? 0;
    doc.font(options.font ?? 'body').fontSize(size).fillColor(options.color ?? INK);

    let remaining = text;

    while (remaining.length > 0) {
      if (bodyBottomY - doc.y < size + 2) {
        newPage();
        continue;
      }

      const available = bodyBottomY - doc.y - 1;
      const full = doc.heightOfString(remaining, { width, lineGap });

      if (full <= available) {
        doc.text(remaining, x, doc.y, { width, lineGap });
        doc.y += spaceAfter;
        return;
      }

      /*
       * Split at the last word boundary whose measured height still fits.
       * Binary search on characters, because pdfkit only reports height for a
       * whole string — measuring every candidate word would be quadratic on a
       * long discharge note.
       */
      let low = 1;
      let high = remaining.length;
      let best = 0;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const height = doc.heightOfString(remaining.slice(0, middle), { width, lineGap });
        if (height <= available) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      if (best <= 0) {
        /* A single unbreakable line taller than the page cannot exist at these
         * sizes; if it somehow does, move on rather than loop forever. */
        newPage();
        continue;
      }

      const space = Math.max(remaining.lastIndexOf(' ', best), remaining.lastIndexOf('\n', best));
      const cut = space > best * 0.6 ? space : best;
      const chunk = remaining.slice(0, cut).trimEnd();
      doc.text(chunk, x, doc.y, { width, lineGap });
      remaining = remaining.slice(cut).trimStart();
      if (remaining.length > 0) newPage();
    }
  };

  const ensure = (needed: number): void => {
    if (doc.y + needed > bodyBottomY) newPage();
  };

  const keyValue = (key: string, value: string): void => {
    doc.font('strong').fontSize(TINY).fillColor(MUTED);
    const keyHeight = doc.heightOfString(key, { width: contentWidth });
    ensure(keyHeight + 14);
    const y = doc.y;
    doc.text(key, left, y, { width: contentWidth });
    const afterKey = y + keyHeight + 1;
    doc.font('body').fontSize(BODY).fillColor(INK);
    doc.text(value, left, afterKey, { width: contentWidth });
    doc.y = Math.max(doc.y, afterKey + 10) + 4;
  };

  const sectionHeading = (title: string, intro?: string, reserved = 58): void => {
    /*
     * A heading plus two lines is 45–55 pt. Reserving more than that leaves a
     * half-empty page whenever the next section happens to be tall, which on a
     * long record turns into a document full of gaps.
     */
    ensure(reserved);
    doc.y += 6;
    const y = doc.y;
    doc.font('strong').fontSize(11.5).fillColor(ACCENT).text(title.toUpperCase(), left, y, {
      width: contentWidth,
      characterSpacing: 0.5,
    });
    const ruleY = doc.y + 3;
    doc
      .moveTo(left, ruleY)
      .lineTo(left + 46, ruleY)
      .lineWidth(2)
      .strokeColor(ACCENT)
      .stroke();
    doc
      .moveTo(left + 50, ruleY)
      .lineTo(left + contentWidth, ruleY)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke();
    doc.y = ruleY + 9;
    if (intro) paragraph(intro, { size: SMALL, color: MUTED, spaceAfter: 4 });
    doc.y += 2;
  };

  const divider = (): void => {
    ensure(14);
    doc.y += 3;
    doc
      .moveTo(left, doc.y)
      .lineTo(left + contentWidth, doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y += 8;
  };

  /* ---------- tables ---------- */

  const drawTable = (columns: Column[], rows: string[][]): void => {
    const padX = 4;
    const padY = 3;
    const widths = columns.map((column) => column.width * contentWidth);
    const xs: number[] = [left];
    for (const width of widths) xs.push(xs[xs.length - 1] + width);

    const measureCell = (index: number, value: string): number => {
      doc.font('body').fontSize(TABLE);
      return doc.heightOfString(value || '—', { width: widths[index] - padX * 2, lineGap: LINE_GAP });
    };

    const headerHeight = (): number => {
      doc.font('strong').fontSize(TINY);
      let tallest = 0;
      columns.forEach((column, index) => {
        tallest = Math.max(
          tallest,
          doc.heightOfString(column.label, { width: widths[index] - padX * 2 }),
        );
      });
      return tallest + padY * 2;
    };

    const drawHeader = (): void => {
      const height = headerHeight();
      const y = doc.y;
      columns.forEach((column, index) => {
        doc.font('strong').fontSize(TINY).fillColor(MUTED);
        doc.text(column.label, xs[index] + padX, y + padY, {
          width: widths[index] - padX * 2,
          align: column.align ?? 'left',
        });
      });
      doc.y = y + height;
      doc
        .moveTo(left, doc.y)
        .lineTo(left + contentWidth, doc.y)
        .lineWidth(0.6)
        .strokeColor(RULE)
        .stroke();
      doc.x = left;
    };

    if (doc.y + headerHeight() + 30 > bodyBottomY) newPage();
    drawHeader();

    for (const row of rows) {
      const heights = columns.map((column, index) => measureCell(index, row[index] ?? ''));
      const rowHeight = Math.max(...heights) + padY * 2;

      /*
       * A value too tall for a whole page cannot be placed as a row without
       * clipping it. Printing it as a labelled block is less pretty and always
       * complete, which is the correct trade for a medical record.
       */
      if (rowHeight > bodyBottomY - top - 40) {
        if (doc.y > top + 40) newPage();
        columns.forEach((column, index) => {
          if (!row[index]) return;
          paragraph(column.label, { size: TINY, color: MUTED, font: 'strong' });
          paragraph(row[index], { size: BODY, spaceAfter: 3 });
        });
        divider();
        continue;
      }

      if (doc.y + rowHeight > bodyBottomY) {
        newPage();
        drawHeader();
      }

      const y = doc.y;
      columns.forEach((column, index) => {
        doc.font('body').fontSize(TABLE).fillColor(INK);
        doc.text(row[index] || '—', xs[index] + padX, y + padY, {
          width: widths[index] - padX * 2,
          align: column.align ?? 'left',
          lineGap: LINE_GAP,
        });
      });
      doc.y = y + rowHeight;
      doc.x = left;

      doc
        .moveTo(left, doc.y)
        .lineTo(left + contentWidth, doc.y)
        .lineWidth(0.3)
        .strokeColor('#e5e7eb')
        .stroke();
    }

    doc.y += 6;
  };

  /* ---------- first page ---------- */

  drawHeader();

  doc.font('strong').fontSize(19).fillColor(INK).text('PATIENT MEDICAL RECORD', left, doc.y, {
    width: contentWidth,
    characterSpacing: 1,
  });
  doc.y += 2;

  paragraph(`Generated ${generated}`, { size: SMALL, color: MUTED, spaceAfter: 6 });

  /* Patient details card. Values are measured, so a long name never collides
   * with the second column or spills out of the shaded box. */
  const fields: Array<[string, string]> = [
    ['Full name', patientName],
    ['Patient number', record.patient.mrn],
    ['Date of birth', formatRecordDate(record.patient.dateOfBirth, timezone) || 'Not recorded'],
    ['Sex', label(record.patient.gender)],
  ];

  if (record.patient.bloodGroup) fields.push(['Blood group', record.patient.bloodGroup]);
  if (record.patient.phone) fields.push(['Telephone', record.patient.phone]);

  const location = [record.patient.subCounty, record.patient.county]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
  if (location) fields.push(['County', location]);

  const cardPadding = 10;
  const columnGap = 16;
  const columnWidth = (contentWidth - cardPadding * 2 - columnGap) / 2;
  const pairRows: Array<Array<[string, string]>> = [];
  for (let index = 0; index < fields.length; index += 2) {
    pairRows.push(fields.slice(index, index + 2));
  }

  const rowHeights = pairRows.map((pair) => {
    let height = 0;
    for (const [key, value] of pair) {
      doc.font('strong').fontSize(TINY);
      const keyHeight = doc.heightOfString(key, { width: columnWidth });
      doc.font('body').fontSize(10);
      const valueHeight = doc.heightOfString(value, { width: columnWidth });
      height = Math.max(height, keyHeight + 1 + valueHeight);
    }
    return height + 7;
  });

  const cardHeight =
    rowHeights.reduce((total, height) => total + height, 0) + cardPadding * 2 - 7;

  ensure(cardHeight + 12);
  const cardTop = doc.y;
  doc.rect(left, cardTop, contentWidth, cardHeight).fillColor(SOFT).fill();

  let cardY = cardTop + cardPadding;
  pairRows.forEach((pair, rowIndex) => {
    pair.forEach(([key, value], columnIndex) => {
      const x = left + cardPadding + columnIndex * (columnWidth + columnGap);
      doc.font('strong').fontSize(TINY).fillColor(MUTED);
      const keyHeight = doc.heightOfString(key, { width: columnWidth });
      doc.text(key, x, cardY, { width: columnWidth });
      doc.font('body').fontSize(10).fillColor(INK);
      doc.text(value, x, cardY + keyHeight + 1, { width: columnWidth });
    });
    cardY += rowHeights[rowIndex];
  });

  doc.y = cardTop + cardHeight + 12;

  paragraph(
    `This copy covers records held at: ${record.facilitiesIncluded.join('; ') || record.facility.name}.`,
    { size: SMALL, color: MUTED, spaceAfter: 2 },
  );
  paragraph(
    'It contains only information your facility has released to your patient portal. Laboratory results appear after a laboratory professional verifies them, and documents appear only after the facility releases them to you.',
    { size: SMALL, color: MUTED, spaceAfter: 2 },
  );

  /* ---------- medical history ---------- */

  sectionHeading(
    'Medical history',
    'Encounters are listed oldest first. Each entry names the facility that treated you.',
  );

  const admissionsByEncounter = new Map<number, typeof record.admissions>();
  const unmatchedAdmissions: typeof record.admissions = [];

  for (const admission of record.admissions) {
    if (admission.encounterId === null) {
      unmatchedAdmissions.push(admission);
      continue;
    }
    const list = admissionsByEncounter.get(admission.encounterId) ?? [];
    list.push(admission);
    admissionsByEncounter.set(admission.encounterId, list);
  }

  const drawAdmission = (admission: (typeof record.admissions)[number]): void => {
    paragraph('Inpatient stay', { size: SMALL, font: 'strong', color: INK, spaceAfter: 1 });
    paragraph(
      `Admitted ${formatRecordDate(admission.admissionDate, timezone) || 'date not recorded'}${
        admission.admissionType ? ` · ${admission.admissionType}` : ''
      }${admission.wardName ? ` · ${admission.wardName}` : ''}`,
      { size: SMALL, color: INK, spaceAfter: 1 },
    );
    if (admission.dischargeDate) {
      paragraph(
        `Discharged ${formatRecordDate(admission.dischargeDate, timezone)}${
          admission.dischargeDisposition ? ` · ${admission.dischargeDisposition}` : ''
        }${admission.dischargeType ? ` (${admission.dischargeType})` : ''}`,
        { size: SMALL, color: INK, spaceAfter: 1 },
      );
    } else {
      paragraph(`Still admitted at the time this copy was generated.`, {
        size: SMALL,
        color: MUTED,
        spaceAfter: 1,
      });
    }
    if (admission.dischargeSummary) {
      paragraph('Discharge summary', { size: SMALL, font: 'strong', color: INK, spaceAfter: 1 });
      paragraph(admission.dischargeSummary, { size: SMALL, spaceAfter: 2 });
    } else if (admission.dischargeDate && !record.policy.dischargeSummaries) {
      paragraph('Discharge summary: not released through your portal.', {
        size: TINY,
        color: MUTED,
        spaceAfter: 2,
      });
    } else if (admission.dischargeDate) {
      paragraph('Discharge summary: none recorded.', { size: TINY, color: MUTED, spaceAfter: 2 });
    }
  };

  if (record.visits.length === 0) {
    paragraph(
      record.admissions.length === 0
        ? 'No encounters have been recorded at the facilities covered by this copy.'
        : 'No outpatient encounters have been recorded at the facilities covered by this copy.',
      { size: BODY, color: INK, spaceAfter: 4 },
    );
  }

  /* Chronological: the service returns newest first for the portal screens. */
  const visits = [...record.visits].sort(
    (a, b) => (a.startedAt ? Date.parse(a.startedAt) : 0) - (b.startedAt ? Date.parse(b.startedAt) : 0),
  );

  for (const visit of visits) {
    ensure(52);
    const y = doc.y;
    doc.font('strong').fontSize(10).fillColor(INK).text(
      `${formatRecordDateTime(visit.startedAt, timezone) || 'Date not recorded'} · ${label(
        visit.encounterType,
      )}`,
      left,
      y,
      { width: contentWidth },
    );
    const headingBottom = doc.y;
    doc.font('body').fontSize(TINY).fillColor(MUTED).text(
      `${visit.facilityName ?? 'Facility not recorded'} · ${label(visit.status)}${
        visit.endedAt ? ` · ended ${formatRecordDateTime(visit.endedAt, timezone)}` : ''
      }`,
      left,
      headingBottom + 1,
      { width: contentWidth },
    );
    doc.y += 4;

    if (visit.chiefComplaint) {
      paragraph(`Reason for visit: ${visit.chiefComplaint}`, { size: SMALL, spaceAfter: 2 });
    }

    if (visit.diagnoses.length > 0) {
      paragraph('Diagnoses', { size: TINY, font: 'strong', color: MUTED, spaceAfter: 1 });
      for (const diagnosis of visit.diagnoses) {
        const code = [diagnosis.codingSystem, diagnosis.code].filter(Boolean).join(' ');
        const qualifiers = [diagnosis.diagnosisType, diagnosis.status]
          .filter((entry): entry is string => Boolean(entry))
          .map((entry) => lowerLabel(entry))
          .join(', ');
        paragraph(`${code ? `${code} — ` : ''}${diagnosis.description}${qualifiers ? ` (${qualifiers})` : ''}`, {
          size: SMALL,
          spaceAfter: 1,
        });
      }
    } else {
      paragraph('Diagnoses: none recorded for this visit.', {
        size: SMALL,
        color: MUTED,
        spaceAfter: 2,
      });
    }

    if (visit.clinicalNotes) {
      paragraph('Clinical notes', { size: TINY, font: 'strong', color: MUTED, spaceAfter: 1 });
      paragraph(visit.clinicalNotes, { size: SMALL, spaceAfter: 2 });
    } else {
      paragraph('Clinical notes: none recorded.', { size: SMALL, color: MUTED, spaceAfter: 2 });
    }

    if (visit.followUpDate) {
      paragraph(`Follow-up advised for ${formatRecordDate(visit.followUpDate, timezone)}.`, {
        size: SMALL,
        color: MUTED,
        spaceAfter: 2,
      });
    }

    for (const admission of admissionsByEncounter.get(visit.encounterId) ?? []) {
      drawAdmission(admission);
    }

    divider();
  }

  /*
   * An admission saved without an encounter link is still an inpatient stay.
   * It is printed once, after the encounter list, rather than dropped because
   * it cannot be attached to a row.
   */
  if (unmatchedAdmissions.length > 0) {
    paragraph('Inpatient stays', { size: SMALL, font: 'strong', color: INK, spaceAfter: 3 });
    for (const admission of unmatchedAdmissions) {
      ensure(60);
      drawAdmission(admission);
      divider();
    }
  }

  /* ---------- allergies ---------- */

  sectionHeading('Allergies', undefined, 110);

  if (!record.policy.allergies) {
    paragraph('Allergy information is not released through your portal at this facility.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else if (record.allergies.length > 0) {
    drawTable(
      [
        { label: 'Allergen', width: 0.28 },
        { label: 'Type', width: 0.14 },
        { label: 'Reaction', width: 0.3 },
        { label: 'Severity', width: 0.14 },
        { label: 'Status', width: 0.14 },
      ],
      record.allergies.map((allergy) => [
        allergy.allergen,
        allergyTypeLabel(allergy.allergenType),
        allergy.reaction || 'Not recorded',
        label(allergy.severity),
        label(allergy.status),
      ]),
    );
  } else {
    const summary = (record.patient.allergySummaryText ?? '').trim();
    if (summary && NO_ALLERGY_TEXT.test(summary)) {
      paragraph('No known allergies.', { size: BODY, spaceAfter: 4 });
    } else if (summary) {
      paragraph(`Allergy information recorded at registration: ${summary}`, {
        size: BODY,
        spaceAfter: 4,
      });
    } else {
      paragraph('No allergy information recorded.', { size: BODY, color: MUTED, spaceAfter: 4 });
    }
  }

  /* ---------- medications ---------- */

  sectionHeading(
    'Medications',
    'Prescriptions are listed with their recorded dispensing status. A prescription with no dispensing record may have been dispensed elsewhere; this copy does not guess.',
    120,
  );

  if (!record.policy.medications) {
    paragraph('Prescription information is not released through your portal at this facility.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else if (record.medications.length === 0) {
    paragraph('No prescriptions have been recorded at the facilities covered by this copy.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else {
    drawTable(
      [
        { label: 'Prescribed', width: 0.14 },
        { label: 'Medicine', width: 0.2 },
        { label: 'Prescription', width: 0.28 },
        { label: 'Status', width: 0.19 },
        { label: 'Prescribed at', width: 0.19 },
      ],
      record.medications.map((medication) => {
        const prescription = [
          medication.dosage,
          medication.frequency,
          medication.duration,
          medication.route ? `Route: ${medication.route}` : null,
          medication.instructions,
        ]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(' · ');

        const status = [
          label(medication.status),
          medication.dispensedAt
            ? `Dispensed ${formatRecordDate(medication.dispensedAt, timezone)}${
                medication.dispensedQuantity !== null
                  ? ` · ${medication.dispensedQuantity} unit(s)`
                  : ''
              }`
            : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join('\n');

        return [
          formatRecordDate(medication.prescribedAt, timezone) || 'Not recorded',
          medication.drugName,
          prescription || 'Prescription details not recorded',
          status,
          medication.facilityName ?? 'Not recorded',
        ];
      }),
    );
  }

  /* ---------- laboratory ---------- */

  sectionHeading(
    'Laboratory results',
    'Only results verified by a laboratory professional are printed. A test with a pending result is shown as pending, with no value, so it cannot be mistaken for a normal result.',
  );

  if (!record.policy.laboratory) {
    paragraph(
      'Laboratory results are not released through your portal at this facility. Ask at the desk for a copy.',
      { size: BODY, color: MUTED, spaceAfter: 4 },
    );
  } else if (record.labOrders.length === 0) {
    paragraph('No laboratory tests have been recorded at the facilities covered by this copy.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else {
    for (const order of record.labOrders) {
      ensure(46);
      const y = doc.y;
      doc.font('strong').fontSize(10).fillColor(INK).text(order.testName, left, y, {
        width: contentWidth,
      });
      doc.font('body').fontSize(TINY).fillColor(MUTED).text(
        `Ordered ${formatRecordDate(order.orderedAt, timezone) || 'date not recorded'} · ${
          order.facilityName ?? 'Facility not recorded'
        } · ${label(order.status)}`,
        left,
        doc.y + 1,
        { width: contentWidth },
      );
      doc.y += 4;

      if (order.results.length > 0) {
        drawTable(
          [
            { label: 'Test', width: 0.3 },
            { label: 'Result', width: 0.16 },
            { label: 'Unit', width: 0.1 },
            { label: 'Reference range', width: 0.16 },
            { label: 'Flag', width: 0.12 },
            { label: 'Verification', width: 0.16 },
          ],
          order.results.map((result) => [
            result.parameterName,
            result.measuredValue,
            result.unit || '—',
            result.referenceRange || 'Not recorded',
            result.flag || '—',
            result.verifiedAt
              ? `Verified\n${formatRecordDate(result.verifiedAt, timezone)}`
              : 'Verified',
          ]),
        );

        if (order.pendingResultCount > 0) {
          paragraph(
            `${order.pendingResultCount} further result(s) on this test ${
              order.pendingResultCount === 1 ? 'is' : 'are'
            } pending verification and are not shown.`,
            { size: TINY, color: MUTED, spaceAfter: 2 },
          );
        }
      } else if (order.pendingResultCount > 0) {
        paragraph('Result pending verification. No value is shown until it is verified.', {
          size: SMALL,
          color: INK,
          spaceAfter: 2,
        });
      } else if (/cancel/i.test(order.status)) {
        paragraph('Order cancelled. No result was issued.', {
          size: SMALL,
          color: MUTED,
          spaceAfter: 2,
        });
      } else {
        paragraph('No result has been recorded for this test yet.', {
          size: SMALL,
          color: MUTED,
          spaceAfter: 2,
        });
      }

      divider();
    }
  }

  /* ---------- radiology ---------- */

  sectionHeading(
    'Radiology and imaging',
    'Requests and reports from radiology. Images themselves are not part of this copy.',
  );

  if (record.radiology.length === 0) {
    paragraph('No radiology requests have been recorded at the facilities covered by this copy.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else {
    for (const order of record.radiology) {
      ensure(46);
      const y = doc.y;
      doc.font('strong').fontSize(10).fillColor(INK).text(order.procedureName, left, y, {
        width: contentWidth,
      });
      doc.font('body').fontSize(TINY).fillColor(MUTED).text(
        `${order.modality} · Requested ${
          formatRecordDate(order.requestedAt, timezone) || 'date not recorded'
        } · ${order.facilityName ?? 'Facility not recorded'} · ${label(order.status)}`,
        left,
        doc.y + 1,
        { width: contentWidth },
      );
      doc.y += 4;

      if (order.status === 'Reported') {
        if (order.findings) {
          paragraph('Findings', { size: TINY, font: 'strong', color: MUTED, spaceAfter: 1 });
          paragraph(order.findings, { size: SMALL, spaceAfter: 2 });
        }
        if (order.impression) {
          paragraph('Impression', { size: TINY, font: 'strong', color: MUTED, spaceAfter: 1 });
          paragraph(order.impression, { size: SMALL, spaceAfter: 2 });
        }
        if (!order.findings && !order.impression) {
          paragraph('A report is recorded, but it contains no findings text.', {
            size: SMALL,
            color: MUTED,
            spaceAfter: 2,
          });
        }
        paragraph(
          `Reported ${formatRecordDate(order.reportedAt, timezone) || 'date not recorded'}.`,
          { size: TINY, color: MUTED, spaceAfter: 2 },
        );
      } else {
        paragraph('No report has been issued yet.', {
          size: SMALL,
          color: MUTED,
          spaceAfter: 2,
        });
      }

      divider();
    }
  }

  /* ---------- appointments ---------- */

  sectionHeading('Appointments', 'Upcoming appointments first, then past appointments.', 110);

  if (!record.policy.appointments) {
    paragraph('Appointments are not shown through your portal at this facility.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else if (record.appointments.length === 0) {
    paragraph('No appointments have been recorded at the facilities covered by this copy.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else {
    const now = Date.parse(record.generatedAt) || Date.now();
    const timestamp = (value: string) => {
      const parsed = zonedInstant(value, timezone);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const upcoming = record.appointments
      .filter((appointment) => timestamp(appointment.scheduledTime) >= now)
      .sort((a, b) => timestamp(a.scheduledTime) - timestamp(b.scheduledTime));
    const past = record.appointments
      .filter((appointment) => timestamp(appointment.scheduledTime) < now)
      .sort((a, b) => timestamp(b.scheduledTime) - timestamp(a.scheduledTime));

    drawTable(
      [
        { label: 'When', width: 0.2 },
        { label: 'Appointment', width: 0.22 },
        { label: 'Facility', width: 0.22 },
        { label: 'Status', width: 0.16 },
        { label: 'Reason', width: 0.2 },
      ],
      [...upcoming, ...past].map((appointment) => [
        `${formatRecordDateTime(appointment.scheduledTime, timezone) || 'Not recorded'}${
          timestamp(appointment.scheduledTime) >= now ? ' · Upcoming' : ' · Past'
        }`,
        appointment.appointmentType ?? 'Appointment',
        appointment.facilityName ?? 'Not recorded',
        label(appointment.status),
        appointment.reason || 'Not recorded',
      ]),
    );
  }

  /* ---------- documents ---------- */

  sectionHeading(
    'Documents released to you',
    'Only documents your facility has explicitly released to your patient portal are listed. Unreleased documents, staff notes and internal working papers are not included.',
    110,
  );

  if (record.documents.length === 0) {
    paragraph('No documents have been released to your portal.', {
      size: BODY,
      color: MUTED,
      spaceAfter: 4,
    });
  } else {
    drawTable(
      [
        { label: 'Document', width: 0.38 },
        { label: 'Type', width: 0.22 },
        { label: 'Group', width: 0.2 },
        { label: 'Date', width: 0.12 },
        { label: 'Version', width: 0.08, align: 'right' },
      ],
      record.documents.map((document) => [
        document.title,
        document.kind,
        document.groupLabel,
        formatRecordDate(document.signedAt ?? document.uploadedAt, timezone) || 'Not recorded',
        `v${document.version}`,
      ]),
    );
  }

  /* ---------- notes ---------- */

  doc.y += 4;
  paragraph('About this copy', { size: SMALL, font: 'strong', color: INK, spaceAfter: 2 });
  paragraph(
    `Generated ${formatGeneratedAt(record.generatedAt, timezone)} by ${record.facility.name} from the records held at the facilities named above.`,
    { size: TINY, color: MUTED, spaceAfter: 1 },
  );
  paragraph(
    'If any information looks wrong, ask the facility to correct it. The patient portal cannot change a clinical record.',
    { size: TINY, color: MUTED, spaceAfter: 1 },
  );
  paragraph(
    'Laboratory results are released only after verification. Radiology images are not included in this copy.',
    { size: TINY, color: MUTED, spaceAfter: 1 },
  );
  if (!letterhead?.bytes) {
    paragraph(
      'Printed without a facility letterhead: none is currently active for this facility.',
      { size: TINY, color: MUTED, spaceAfter: 1 },
    );
  }

  /* ---------- footer on every page ---------- */

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  /*
   * The footer is a per-page identification band, not a second title page: the
   * generation stamp is in the body and in the PDF metadata, so a long stamp
   * here would wrap into the letterhead's lower margin. Patient and record
   * number are what a loose page needs to be matched back to its owner.
   */
  const footerParts = [patientName, `MRN ${record.patient.mrn}`, 'Patient Medical Record'];

  for (let index = 0; index < totalPages; index += 1) {
    doc.switchToPage(range.start + index);
    const page = doc.page;
    const previousBottom = page.margins.bottom;
    page.margins.bottom = 0;

    const footerY = heightPt - bottom + 6;
    doc.font('body').fontSize(7).fillColor(MUTED);
    doc.text(footerParts.join(' · '), left, footerY, {
      width: contentWidth * 0.75,
      lineBreak: false,
    });
    doc.text(`Page ${index + 1} of ${totalPages}`, left + contentWidth * 0.75, footerY, {
      width: contentWidth * 0.25,
      align: 'right',
      lineBreak: false,
    });

    page.margins.bottom = previousBottom;
  }

  doc.end();
  const contentBytes = await finished;

  if (!letterhead?.bytes) {
    const loaded = await PDFComposer.load(contentBytes, { updateMetadata: false });
    return { bytes: contentBytes, pages: loaded.getPageCount(), letterheadApplied: false };
  }

  const composed = await composeOnLetterhead(contentBytes, letterhead, {
    title: 'Patient Medical Record',
    author: record.facility.name,
    subject: 'Patient medical record',
    pageWidthPt: widthPt,
    pageHeightPt: heightPt,
  });

  return { bytes: composed.bytes, pages: composed.pages, letterheadApplied: true };
}

/** A filesystem- and header-safe name: `medical-record-MRN-2026-10-27.pdf`. */
export function medicalRecordFilename(mrn: string | null, date: Date): string {
  const safeMrn = (mrn ?? 'patient').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `medical-record-${safeMrn || 'patient'}-${localDateStamp(date)}.pdf`;
}
