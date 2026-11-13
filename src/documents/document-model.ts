/**
 * What a printable document is, before it is a PDF.
 *
 * Every document this system issues — invoice, receipt, credit note, LPO, GRN,
 * laboratory report, imaging report, discharge summary — is the same shape: a
 * party, some identifying facts, a table or some prose, and totals. Modelling
 * that once means the letterhead, the pagination, the typography and the
 * authorization live in one place, and a new document type cannot accidentally
 * bypass them.
 *
 * The model is deliberately printable-only. It carries no ids the renderer
 * could use to look anything up: by the time a `DocumentModel` exists, every
 * value in it came from a persisted row that an authorization check already
 * admitted. That is what makes "do not invent data" structural rather than a
 * promise.
 */

export type DocumentKind =
  | 'INVOICE'
  | 'RECEIPT'
  | 'CREDIT_NOTE'
  | 'PURCHASE_ORDER'
  | 'GOODS_RECEIVED_NOTE'
  | 'LABORATORY_REPORT'
  | 'RADIOLOGY_REPORT'
  | 'DISCHARGE_SUMMARY';

/** Who the document is from. Taken from the facility row, never from a brand constant. */
export interface DocumentFacility {
  name: string;
  code: string;
  registryCode: string | null;
  address: string | null;
  county: string | null;
  phone: string | null;
  email: string | null;
}

export interface DocumentField {
  label: string;
  value: string;
}

export interface DocumentColumn {
  label: string;
  /** Fraction of the printable width. Fractions must sum to 1. */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface DocumentTable {
  columns: DocumentColumn[];
  rows: string[][];
  /** Repeated above every continuation page. */
  repeatHeader?: boolean;
}

export interface DocumentSection {
  heading: string;
  body: string;
}

export interface DocumentTotal {
  label: string;
  value: string;
  /** Renders bolder and with a rule above. */
  emphasis?: boolean;
}

export interface DocumentModel {
  kind: DocumentKind;
  title: string;
  subtitle?: string;
  /** The reference a human quotes: invoice number, receipt number, PO number. */
  documentNumber: string;
  /** ISO-8601 instant the document is issued. */
  issuedAt: string;
  facility: DocumentFacility;

  /** Identifying facts in two columns under the title. */
  leftFields: DocumentField[];
  rightFields: DocumentField[];

  table?: DocumentTable;
  sections?: DocumentSection[];
  totals?: DocumentTotal[];
  notes?: string[];

  /**
   * Names the branding a reprint resolved to, printed in the footer so a
   * document can be traced to the letterhead version it was issued under.
   */
  brandingNote?: string | null;

  /**
   * A narrow till-roll layout for receipts. Thermal paper has no letterhead:
   * applying one would be physically impossible, so this mode renders without
   * one by design rather than by omission.
   */
  thermal?: boolean;
}

/** A4 in points. 595.28 × 841.89 nominally; the exact value used by most PDF tools. */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
