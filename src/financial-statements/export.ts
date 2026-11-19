/**
 * JaliCare HMIS — PDF and Excel export of a generated statement set.
 *
 * The export reads the *archived* payload, so what a reviewer approved is
 * exactly what a reader downloads. A draft carries a visible provisional
 * banner; an approved statement carries the approver and the approval time.
 */

import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { boldFontPath, contentFontPath } from '../documents/render.ts';
import { cents, formatKes } from './money.ts';
import type {
  EquityStatementBlock,
  StatementBlock,
  StatementPayload,
  StatementRow,
} from './types.ts';

export type ExportFormat = 'pdf' | 'xlsx';
export type ExportStatement =
  | 'ALL'
  | 'financialPosition'
  | 'incomeStatement'
  | 'cashFlows'
  | 'changesInEquity'
  | 'trialBalance'
  | 'generalLedger'
  | 'cashbook'
  | 'receivables'
  | 'payables'
  | 'fixedAssets';

export interface ExportMeta {
  status: string;
  version: number;
  approvedByName: string | null;
  approvedAt: string | null;
  generatedByName: string | null;
}

export interface ExportOutput {
  filename: string;
  contentType: string;
  base64: string;
  byteLength: number;
  contentHash: string;
}

const TITLES: Record<Exclude<ExportStatement, 'ALL'>, string> = {
  financialPosition: 'Statement of Financial Position',
  incomeStatement: 'Income Statement',
  cashFlows: 'Statement of Cash Flows',
  changesInEquity: "Statement of Changes in Partners' Equity",
  trialBalance: 'Trial Balance',
  generalLedger: 'General Ledger',
  cashbook: 'Cashbook and Bank Statements',
  receivables: 'Accounts Receivable Statement',
  payables: 'Accounts Payable Statement',
  fixedAssets: 'Fixed Asset Register and Depreciation Schedule',
};

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#d1d5db';
const WARN = '#b91c1c';
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const BOTTOM = 66;
const LABEL_RIGHT = 345;
const NOTE_RIGHT = 366;
const PRIOR_RIGHT = 460;
const CURRENT_RIGHT = 556;

type AmountPair = { current: string; prior: string | null };

function statementRows(block: StatementBlock): Array<{
  label: string;
  note: string | null;
  kind: StatementRow['kind'];
  depth: number;
  amounts: AmountPair;
}> {
  return block.rows.map((row) => ({
    label: row.label,
    note: row.note,
    kind: row.kind,
    depth: row.depth,
    amounts: { current: row.currentCents, prior: row.priorCents },
  }));
}

function subheading(payload: StatementPayload, meta: ExportMeta): string[] {
  const head = [
    `${payload.meta.facilityName}${payload.meta.facilityCode ? ` (${payload.meta.facilityCode})` : ''}`,
    payload.meta.facilityAddress ?? '',
    `Currency: ${payload.meta.currency}   Basis: ${payload.meta.accountingBasis}   Financial year: ${payload.meta.financialYear}`,
    `Generated ${payload.meta.generatedAt.slice(0, 19).replace('T', ' ')} UTC by ${payload.meta.generatedByName ?? 'system'}`,
    `Version ${meta.version} — ${meta.status}`,
    meta.approvedAt
      ? `Approved ${meta.approvedAt.slice(0, 19).replace('T', ' ')} UTC by ${meta.approvedByName ?? 'an authorised user'}`
      : '',
  ];
  return head.filter(Boolean);
}

/* ============================================================
   PDF
   ============================================================ */

interface PdfOptions {
  payload: StatementPayload;
  meta: ExportMeta;
  statement: ExportStatement;
}

function pdfDocument(options: PdfOptions): Promise<Buffer> {
  const { payload, meta, statement } = options;
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: BOTTOM, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: `${statement === 'ALL' ? 'Financial statements' : TITLES[statement]} ${payload.meta.periodEnd}`,
      Author: payload.meta.facilityName,
      Subject: 'Financial statements',
      Creator: 'JaliCare HMIS',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.registerFont('body', contentFontPath());
  doc.registerFont('strong', boldFontPath());
  doc.font('body').fillColor(INK);

  let context = '';
  const drawHeader = () => {
    doc.font('strong').fontSize(11).fillColor(INK);
    doc.text(payload.meta.facilityName, MARGIN, MARGIN, { width: PAGE_W - MARGIN * 2 });
    doc.font('body').fontSize(7.5).fillColor(MUTED);
    doc.text(
      `${context || 'Financial statements'}  |  ${payload.meta.periodLabel}  |  ${payload.meta.currency}`,
      MARGIN,
      doc.y + 1,
      { width: PAGE_W - MARGIN * 2 },
    );
    if (meta.status !== 'APPROVED') {
      doc.font('strong').fontSize(7.5).fillColor(WARN);
      doc.text(
        `PROVISIONAL — version ${meta.version} is ${meta.status.toLowerCase()}, not approved`,
        MARGIN,
        doc.y,
        {
          width: PAGE_W - MARGIN * 2,
        },
      );
      doc.fillColor(INK);
    }
    doc
      .moveTo(MARGIN, doc.y + 4)
      .lineTo(PAGE_W - MARGIN, doc.y + 4)
      .lineWidth(0.6)
      .strokeColor(RULE)
      .stroke();
    doc.y += 10;
  };

  doc.on('pageAdded', () => {
    drawHeader();
  });

  const ensure = (height: number) => {
    if (doc.y + height > PAGE_H - BOTTOM) doc.addPage();
  };

  const heading = (title: string, subtitle: string | null) => {
    ensure(46);
    doc
      .font('strong')
      .fontSize(12)
      .fillColor(INK)
      .text(title, MARGIN, doc.y, {
        width: PAGE_W - MARGIN * 2,
      });
    doc.font('body').fontSize(8).fillColor(MUTED);
    doc.text(subtitle ?? payload.meta.periodLabel, { width: PAGE_W - MARGIN * 2 });
    if (payload.meta.comparativeLabel && !subtitle) {
      doc.text(`Comparative: ${payload.meta.comparativeLabel}`, { width: PAGE_W - MARGIN * 2 });
    }
    doc.fillColor(INK);
    doc.y += 4;
  };

  const columnHeader = (block: StatementBlock) => {
    ensure(18);
    const y = doc.y;
    doc.font('strong').fontSize(7.5).fillColor(MUTED);
    doc.text('', MARGIN, y);
    doc.text(block.columns.current, PRIOR_RIGHT, y, {
      width: CURRENT_RIGHT - PRIOR_RIGHT,
      align: 'right',
    });
    if (block.columns.prior) {
      doc.text(block.columns.prior, LABEL_RIGHT, y, {
        width: PRIOR_RIGHT - LABEL_RIGHT - 4,
        align: 'right',
      });
    }
    doc.fillColor(INK);
    doc.y = y + 11;
  };

  const renderRow = (row: ReturnType<typeof statementRows>[number]) => {
    ensure(13);
    const y = doc.y;
    const bold = row.kind === 'TOTAL' || row.kind === 'SUBTOTAL' || row.kind === 'SECTION';
    const indented = row.depth > 0;
    doc.font(bold ? 'strong' : 'body').fontSize(bold ? 8.4 : 8);
    const labelX = MARGIN + (row.depth > 1 ? 14 : row.depth === 1 ? 7 : 0);
    doc.fillColor(row.kind === 'TOTAL' ? INK : row.kind === 'SECTION' ? INK : '#1f2937');
    doc.text(row.label, labelX, y, { width: LABEL_RIGHT - labelX, lineBreak: false });
    if (row.note) {
      doc.font('body').fontSize(6.8).fillColor(MUTED);
      doc.text(row.note, LABEL_RIGHT, y + 1, { width: NOTE_RIGHT - LABEL_RIGHT, align: 'right' });
    }
    doc
      .font(bold ? 'strong' : 'body')
      .fontSize(8)
      .fillColor(INK);
    if (row.amounts.prior !== null) {
      doc.text(formatKes(cents(row.amounts.prior)), LABEL_RIGHT, y, {
        width: PRIOR_RIGHT - LABEL_RIGHT - 6,
        align: 'right',
      });
    }
    doc.text(formatKes(cents(row.amounts.current)), PRIOR_RIGHT, y, {
      width: CURRENT_RIGHT - PRIOR_RIGHT,
      align: 'right',
    });
    doc.y = y + (indented ? 11 : 12.5);
    if (row.kind === 'TOTAL') {
      doc
        .moveTo(MARGIN, doc.y - 1)
        .lineTo(CURRENT_RIGHT, doc.y - 1)
        .lineWidth(0.6)
        .strokeColor(INK)
        .stroke();
      doc.y += 2;
    }
  };

  const renderBlock = (block: StatementBlock) => {
    heading(block.title, block.subtitle ?? null);
    columnHeader(block);
    for (const row of statementRows(block)) renderRow(row);
  };

  const renderEquity = (block: EquityStatementBlock) => {
    heading(block.title, block.subtitle);
    ensure(22);
    const y = doc.y;
    doc.font('strong').fontSize(6.6).fillColor(MUTED);
    doc.text('', MARGIN, y);
    const columns: Array<[string, number, number]> = [
      ['Opening', 300, 60],
      ['Introduced', 362, 55],
      ['Withdrawn', 419, 55],
      ['Result', 476, 45],
      ['Transfer', 523, 33],
    ];
    for (const [label, x, width] of columns) {
      doc.text(label, x, y, { width, align: 'right' });
    }
    doc.fillColor(INK);
    doc.y = y + 11;
    const money = (value: string) => formatKes(cents(value));
    for (const row of block.rows) {
      ensure(12);
      const rowY = doc.y;
      const bold = row.kind === 'TOTAL';
      doc
        .font(bold ? 'strong' : 'body')
        .fontSize(7.4)
        .fillColor(INK);
      doc.text(row.label, MARGIN, rowY, { width: 256, lineBreak: false });
      doc.font('body').fontSize(7);
      for (const [value, x, width] of [
        [row.openingCents, 300, 60],
        [row.introducedCents, 362, 55],
        [row.withdrawnCents, 419, 55],
        [row.resultCents, 476, 45],
        [row.transfersCents, 523, 33],
      ] as Array<[string, number, number]>) {
        if (value === '0') {
          doc.fillColor(MUTED).text('—', x, rowY + 0.5, { width, align: 'right' });
          doc.fillColor(INK);
        } else {
          doc.text(money(value), x, rowY + 0.5, { width, align: 'right' });
        }
      }
      doc.y = rowY + 11.5;
    }
    doc.moveTo(MARGIN, doc.y).lineTo(CURRENT_RIGHT, doc.y).lineWidth(0.6).strokeColor(INK).stroke();
    doc.y += 3;
    doc.font('strong').fontSize(8);
    doc.text('EQUITY AT THE END OF THE PERIOD', MARGIN, doc.y, { width: 256, lineBreak: false });
    doc.text(money(block.totals.closingCents), PRIOR_RIGHT, doc.y, {
      width: CURRENT_RIGHT - PRIOR_RIGHT,
      align: 'right',
    });
    doc.y += 14;
    if (block.partnerRegister) {
      const memo = block.partnerRegister;
      doc.font('body').fontSize(7.5).fillColor(MUTED);
      doc.text(
        memo.available
          ? `Partner equity register ${memo.statementId ? `#${memo.statementId} ` : ''}(${memo.status ?? 'unknown'}) totals ${formatKes(cents(memo.closingTotalCents ?? '0'))}` +
              ` against ledger partners' capital of ${formatKes(cents(memo.ledgerPartnersCapitalCents))}` +
              (memo.differenceCents && memo.differenceCents !== '0'
                ? `; difference ${formatKes(cents(memo.differenceCents))} (shown, not adjusted)`
                : '; the two agree')
          : 'No partner equity statement covers this period; the equity statement is derived from the ledger alone.',
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2 },
      );
      doc.fillColor(INK);
      doc.y += 6;
    }
  };

  const renderTrialBalance = () => {
    const tb = payload.schedules.trialBalance;
    heading('Trial Balance', `As at ${tb.asAt}`);
    ensure(20);
    let y = doc.y;
    doc.font('strong').fontSize(6.8).fillColor(MUTED);
    doc.text('Code', MARGIN, y, { width: 38 });
    doc.text('Account', MARGIN + 40, y, { width: 160 });
    doc.text('Debit', 240, y, { width: 70, align: 'right' });
    doc.text('Credit', 315, y, { width: 70, align: 'right' });
    doc.text('Debit', 390, y, { width: 70, align: 'right' });
    doc.text('Credit', 465, y, { width: 70, align: 'right' });
    doc.fillColor(INK);
    doc.y = y + 10;
    for (const row of tb.rows) {
      ensure(11);
      y = doc.y;
      doc.font('body').fontSize(6.9);
      doc.text(row.accountCode, MARGIN, y, { width: 38, lineBreak: false });
      doc.text(row.accountName, MARGIN + 40, y, { width: 195, lineBreak: false });
      doc.fontSize(6.6);
      doc.text(formatKes(cents(row.openingDebitCents)), 240, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(row.openingCreditCents)), 315, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(row.closingDebitCents)), 390, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(row.closingCreditCents)), 465, y, { width: 70, align: 'right' });
      doc.y = y + 10.2;
    }
    ensure(16);
    y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(CURRENT_RIGHT, y).strokeColor(INK).lineWidth(0.6).stroke();
    doc.font('strong').fontSize(7.2).fillColor(INK);
    doc.text('Totals', MARGIN, y + 3, { width: 195 });
    doc.text(formatKes(cents(tb.totals.openingDebitCents)), 240, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(tb.totals.openingCreditCents)), 315, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(tb.totals.closingDebitCents)), 390, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(tb.totals.closingCreditCents)), 465, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.y = y + 18;
    doc
      .font('body')
      .fontSize(7)
      .fillColor(tb.ties ? MUTED : WARN);
    doc.text(
      tb.ties
        ? 'Opening, movement and closing columns each balance.'
        : 'A trial-balance column does not balance. The differences are shown, not adjusted.',
      MARGIN,
      doc.y,
      { width: PAGE_W - MARGIN * 2 },
    );
    doc.fillColor(INK);
  };

  const renderCashbook = () => {
    const cashbook = payload.schedules.cashbook;
    heading('Cashbook and Bank Statements', `${cashbook.periodStart} to ${cashbook.periodEnd}`);
    for (const account of cashbook.accounts) {
      ensure(60);
      doc.font('strong').fontSize(8.4).fillColor(INK);
      doc.text(
        `${account.name}${account.accountNumberMasked ? ` (${account.accountNumberMasked})` : ''} — GL ${account.glAccountCode} ${account.glAccountName}`,
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2 },
      );
      doc.font('body').fontSize(7.4).fillColor(MUTED);
      doc.text(
        [
          `Opening ${formatKes(cents(account.ledgerOpeningCents))}`,
          `Receipts ${formatKes(cents(account.receiptsCents))}`,
          `Payments ${formatKes(cents(account.paymentsCents))}`,
          `Closing ${formatKes(cents(account.ledgerClosingCents))}`,
          account.storedBookBalanceCents === null
            ? 'No bank account record is linked to this cash account'
            : `Bank book balance ${formatKes(cents(account.storedBookBalanceCents))}` +
              (account.differenceCents && account.differenceCents !== '0'
                ? ` (difference ${formatKes(cents(account.differenceCents))})`
                : ''),
        ].join('   •   '),
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2 },
      );
      doc.fillColor(INK);
      doc.y += 8;
    }
    doc.font('body').fontSize(7).fillColor(MUTED);
    doc.text(
      `Total cash and bank at ${cashbook.periodEnd}: ${formatKes(cents(cashbook.totals.closingCents))}. ` +
        'Only balances derived from posted journals are shown; imported bank statement lines are listed in the workspace.',
      MARGIN,
      doc.y,
      { width: PAGE_W - MARGIN * 2 },
    );
    doc.fillColor(INK);
  };

  const renderParty = (side: 'receivables' | 'payables') => {
    const block = payload.schedules[side];
    const title =
      side === 'receivables' ? 'Accounts Receivable Statement' : 'Accounts Payable Statement';
    heading(
      title,
      `As at ${block.asAt}${block.controlAccountCodes.length ? ` — control accounts ${block.controlAccountCodes.join(', ')}` : ''}`,
    );
    ensure(20);
    let y = doc.y;
    doc.font('strong').fontSize(6.8).fillColor(MUTED);
    doc.text('Debtor / creditor', MARGIN, y, { width: 200 });
    doc.text('Current', 235, y, { width: 62, align: 'right' });
    doc.text('31–60', 300, y, { width: 55, align: 'right' });
    doc.text('61–90', 358, y, { width: 55, align: 'right' });
    doc.text('Over 90', 416, y, { width: 60, align: 'right' });
    doc.text('Balance', 480, y, { width: 74, align: 'right' });
    doc.fillColor(INK);
    doc.y = y + 10;
    for (const row of block.rows) {
      ensure(11);
      y = doc.y;
      doc.font('body').fontSize(7);
      doc.text(row.name, MARGIN, y, { width: 195, lineBreak: false });
      doc.fontSize(6.6);
      for (const [value, x, width] of [
        [row.currentCents, 235, 62],
        [row.days30Cents, 300, 55],
        [row.days60Cents, 358, 55],
        [row.over90Cents, 416, 60],
        [row.balanceCents, 480, 74],
      ] as Array<[string, number, number]>) {
        doc.text(formatKes(cents(value)), x, y, { width, align: 'right' });
      }
      doc.y = y + 10.2;
    }
    ensure(30);
    doc.font('body').fontSize(7).fillColor(MUTED);
    doc.text(
      `Control accounts ${formatKes(cents(block.controlCents))}; party balances ${formatKes(cents(block.totalCents))}; ` +
        `unallocated lines ${formatKes(cents(block.unallocatedCents))}; difference ${formatKes(cents(block.differenceCents))}. ` +
        (block.differenceCents === '0'
          ? 'The statement reconciles to the control accounts.'
          : 'The difference is shown, not adjusted.'),
      MARGIN,
      doc.y + 4,
      { width: PAGE_W - MARGIN * 2 },
    );
    if (block.creditBalancesCents !== '0') {
      doc.text(
        `Credit balances of ${formatKes(cents(block.creditBalancesCents))} are included in the party balances above.`,
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2 },
      );
    }
    doc.fillColor(INK);
    doc.y += 4;
  };

  const renderFixedAssets = () => {
    const register = payload.schedules.fixedAssets;
    heading('Fixed Asset Register and Depreciation Schedule', `As at ${register.asAt}`);
    ensure(20);
    let y = doc.y;
    doc.font('strong').fontSize(6.8).fillColor(MUTED);
    doc.text('Code / asset', MARGIN, y, { width: 200 });
    doc.text('Acquired', 240, y, { width: 55 });
    doc.text('Cost', 297, y, { width: 70, align: 'right' });
    doc.text('Depreciation', 372, y, { width: 70, align: 'right' });
    doc.text('Net book value', 447, y, { width: 70, align: 'right' });
    doc.text('Charge', 519, y, { width: 37, align: 'right' });
    doc.fillColor(INK);
    doc.y = y + 10;
    for (const asset of register.rows) {
      ensure(12);
      y = doc.y;
      doc.font('body').fontSize(7);
      doc.text(`${asset.assetCode} ${asset.assetName}`, MARGIN, y, {
        width: 195,
        lineBreak: false,
      });
      doc.fontSize(6.4).fillColor(MUTED);
      doc.text(asset.acquisitionDate, 240, y, { width: 55 });
      doc.fillColor(INK).fontSize(6.6);
      doc.text(formatKes(cents(asset.costCents)), 297, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(asset.accumulatedCents)), 372, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(asset.netBookValueCents)), 447, y, { width: 70, align: 'right' });
      doc.text(formatKes(cents(asset.periodChargeCents)), 519, y, { width: 37, align: 'right' });
      doc.y = y + 10.4;
    }
    ensure(20);
    y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(CURRENT_RIGHT, y).strokeColor(INK).stroke();
    doc.font('strong').fontSize(7);
    doc.text('Totals', MARGIN, y + 3, { width: 195 });
    doc.text(formatKes(cents(register.totals.costCents)), 297, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(register.totals.accumulatedCents)), 372, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(register.totals.netBookValueCents)), 447, y + 3, {
      width: 70,
      align: 'right',
    });
    doc.text(formatKes(cents(register.totals.periodChargeCents)), 519, y + 3, {
      width: 37,
      align: 'right',
    });
    doc.y = y + 18;
    const rec = register.reconciliation;
    doc
      .font('body')
      .fontSize(7)
      .fillColor(
        rec.costDifferenceCents === '0' && rec.accumulatedDifferenceCents === '0' ? MUTED : WARN,
      );
    doc.text(
      `Register cost ${formatKes(cents(rec.registerCostCents))} versus PPE control ${formatKes(cents(rec.ledgerCostCents))} ` +
        `(difference ${formatKes(cents(rec.costDifferenceCents))}); accumulated depreciation ` +
        `${formatKes(cents(rec.registerAccumulatedCents))} versus control ${formatKes(cents(rec.ledgerAccumulatedCents))} ` +
        `(difference ${formatKes(cents(rec.accumulatedDifferenceCents))}). Depreciation charged this period ` +
        `${formatKes(cents(rec.batchChargeCents))} from ${rec.batchesPosted} posted batch(es) against ` +
        `${formatKes(cents(rec.ledgerChargeCents))} in the ledger.`,
      MARGIN,
      doc.y,
      { width: PAGE_W - MARGIN * 2 },
    );
    doc.fillColor(INK);
  };

  const renderGeneralLedger = () => {
    const ledger = payload.schedules.generalLedger;
    heading('General Ledger', `${ledger.periodStart} to ${ledger.periodEnd}`);
    for (const account of ledger.accounts) {
      ensure(40);
      doc.font('strong').fontSize(8).fillColor(INK);
      doc.text(`${account.accountCode} ${account.accountName}`, MARGIN, doc.y, { width: 340 });
      doc.font('body').fontSize(7).fillColor(MUTED);
      doc.text(
        `Opening ${formatKes(cents(account.openingCents))}   Closing ${formatKes(cents(account.closingCents))}`,
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2, align: 'right' },
      );
      doc.fillColor(INK);
      doc.y += 3;
      for (const line of account.lines) {
        ensure(10);
        const y = doc.y;
        doc.font('body').fontSize(6.6);
        doc.text(line.entryDate, MARGIN, y, { width: 48, lineBreak: false });
        doc.text(line.description.slice(0, 68), MARGIN + 50, y, { width: 230, lineBreak: false });
        doc.text(line.debitCents === '0' ? '' : formatKes(cents(line.debitCents)), 330, y, {
          width: 65,
          align: 'right',
        });
        doc.text(line.creditCents === '0' ? '' : formatKes(cents(line.creditCents)), 398, y, {
          width: 65,
          align: 'right',
        });
        doc.text(formatKes(cents(line.runningCents)), 466, y, { width: 88, align: 'right' });
        doc.y = y + 9.6;
      }
      doc.y += 4;
    }
  };

  const renderChecks = () => {
    heading('Reconciliation and Validation Checks', `As at ${payload.meta.periodEnd}`);
    for (const check of payload.checks) {
      ensure(24);
      doc
        .font('strong')
        .fontSize(7.6)
        .fillColor(check.status === 'FAIL' ? WARN : check.status === 'WARNING' ? '#92400e' : INK);
      doc.text(`${check.status} — ${check.label}`, MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.font('body').fontSize(7).fillColor(MUTED);
      doc.text(check.detail, MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.fillColor(INK);
      doc.y += 3;
    }
  };

  const renderNotes = () => {
    if (!payload.notes.length) return;
    heading('Management Notes', null);
    for (const note of payload.notes) {
      ensure(26);
      doc.font('strong').fontSize(7.8).fillColor(INK);
      doc.text(`${note.noteRef}. ${note.title}`, MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.font('body').fontSize(7).fillColor(MUTED);
      doc.text(note.body, MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
      doc.text(
        `Recorded by ${note.authorName ?? `user ${note.authorUserId ?? 'unknown'}`} at ${note.recordedAt.slice(0, 19).replace('T', ' ')} UTC`,
        MARGIN,
        doc.y,
        { width: PAGE_W - MARGIN * 2 },
      );
      doc.fillColor(INK);
      doc.y += 5;
    }
  };

  const renderPrimary = (block: StatementBlock | EquityStatementBlock) => {
    if ('rows' in block && block.key === 'changesInEquity') {
      renderEquity(block as EquityStatementBlock);
      return;
    }
    renderBlock(block as StatementBlock);
  };

  const all = statement === 'ALL';
  context = all ? 'Financial statements' : TITLES[statement];
  drawHeader();

  if (all) {
    const intro = subheading(payload, meta);
    doc.font('body').fontSize(7.5).fillColor(MUTED);
    doc.text(intro.join('\n'), MARGIN, doc.y, { width: PAGE_W - MARGIN * 2 });
    doc.fillColor(INK);
    doc.y += 8;
    renderPrimary(payload.statements.financialPosition);
    renderPrimary(payload.statements.incomeStatement);
    renderPrimary(payload.statements.cashFlows);
    renderPrimary(payload.statements.changesInEquity);
    renderTrialBalance();
    renderCashbook();
    renderParty('receivables');
    renderParty('payables');
    renderFixedAssets();
    renderChecks();
    renderNotes();
  } else if (statement === 'financialPosition') {
    renderPrimary(payload.statements.financialPosition);
    renderChecks();
  } else if (statement === 'incomeStatement') {
    renderPrimary(payload.statements.incomeStatement);
  } else if (statement === 'cashFlows') {
    renderPrimary(payload.statements.cashFlows);
  } else if (statement === 'changesInEquity') {
    renderPrimary(payload.statements.changesInEquity);
    renderNotes();
  } else if (statement === 'trialBalance') {
    renderTrialBalance();
  } else if (statement === 'cashbook') {
    renderCashbook();
  } else if (statement === 'receivables') {
    renderParty('receivables');
  } else if (statement === 'payables') {
    renderParty('payables');
  } else if (statement === 'fixedAssets') {
    renderFixedAssets();
  } else if (statement === 'generalLedger') {
    renderGeneralLedger();
  }

  // Page numbers, once every page exists.
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.font('body').fontSize(7).fillColor(MUTED);
    doc.text(
      `${payload.meta.facilityName} — ${context} — page ${index + 1} of ${range.count}`,
      MARGIN,
      PAGE_H - 42,
      { width: PAGE_W - MARGIN * 2, align: 'center', lineBreak: false },
    );
  }

  doc.end();
  return done;
}

/* ============================================================
   Excel
   ============================================================ */

const NUMBER_FORMAT = '#,##0.00;[Red](#,##0.00)';

function amountCell(value: string, bold = false) {
  return {
    value: Number(cents(value)) / 100,
    type: Number,
    format: NUMBER_FORMAT,
    fontWeight: bold ? ('bold' as const) : undefined,
  };
}

function textCell(value: string, bold = false, align?: 'right') {
  return { value, type: String, fontWeight: bold ? ('bold' as const) : undefined, align };
}

function blockSheet(
  title: string,
  payload: StatementPayload,
  block: StatementBlock,
  meta: ExportMeta,
): SheetData {
  const head: SheetData = [
    [textCell(payload.meta.facilityName, true)],
    [textCell(title, true)],
    [textCell(block.subtitle ?? payload.meta.periodLabel)],
    [
      textCell(
        `Version ${meta.version} — ${meta.status}${meta.approvedAt ? ` (approved ${meta.approvedAt.slice(0, 10)} by ${meta.approvedByName ?? ''})` : ''}`,
      ),
    ],
    [],
    [
      textCell('Line', true),
      textCell('Note', true),
      textCell(block.columns.prior ?? '', true),
      textCell(block.columns.current, true),
    ],
  ];
  for (const row of block.rows) {
    head.push([
      textCell(
        `${'  '.repeat(row.depth)}${row.label}`,
        row.kind === 'TOTAL' || row.kind === 'SUBTOTAL',
      ),
      textCell(row.note ?? ''),
      row.priorCents === null ? textCell('') : amountCell(row.priorCents, row.kind === 'TOTAL'),
      amountCell(row.currentCents, row.kind === 'TOTAL'),
    ]);
  }
  return head;
}

function equitySheet(
  payload: StatementPayload,
  block: EquityStatementBlock,
  meta: ExportMeta,
): SheetData {
  const head: SheetData = [
    [textCell(payload.meta.facilityName, true)],
    [textCell(block.title, true)],
    [textCell(block.subtitle ?? '')],
    [textCell(`Version ${meta.version} — ${meta.status}`)],
    [],
    [
      textCell('Component', true),
      textCell('Opening', true),
      textCell('Introduced', true),
      textCell('Withdrawn', true),
      textCell('Result', true),
      textCell('Transfers', true),
      textCell('Closing', true),
    ],
  ];
  for (const row of block.rows) {
    head.push([
      textCell(row.label, row.kind === 'TOTAL'),
      amountCell(row.openingCents),
      amountCell(row.introducedCents),
      amountCell(row.withdrawnCents),
      amountCell(row.resultCents),
      amountCell(row.transfersCents),
      amountCell(row.closingCents, row.kind === 'TOTAL'),
    ]);
  }
  head.push([]);
  head.push([
    textCell('Total equity at the end of the period', true),
    textCell(''),
    textCell(''),
    textCell(''),
    textCell(''),
    textCell(''),
    amountCell(block.totals.closingCents, true),
  ]);
  return head;
}

function trialBalanceSheet(payload: StatementPayload): SheetData {
  const tb = payload.schedules.trialBalance;
  const sheet: SheetData = [
    [textCell('Trial Balance', true)],
    [textCell(`As at ${tb.asAt}`)],
    [],
    [
      textCell('Code', true),
      textCell('Account', true),
      textCell('Type', true),
      textCell('Opening debit', true),
      textCell('Opening credit', true),
      textCell('Movement debit', true),
      textCell('Movement credit', true),
      textCell('Closing debit', true),
      textCell('Closing credit', true),
    ],
  ];
  for (const row of tb.rows) {
    sheet.push([
      textCell(row.accountCode),
      textCell(row.accountName),
      textCell(row.accountType),
      amountCell(row.openingDebitCents),
      amountCell(row.openingCreditCents),
      amountCell(row.movementDebitCents),
      amountCell(row.movementCreditCents),
      amountCell(row.closingDebitCents),
      amountCell(row.closingCreditCents),
    ]);
  }
  sheet.push([
    textCell('Totals', true),
    textCell(''),
    textCell(''),
    amountCell(tb.totals.openingDebitCents, true),
    amountCell(tb.totals.openingCreditCents, true),
    amountCell(tb.totals.movementDebitCents, true),
    amountCell(tb.totals.movementCreditCents, true),
    amountCell(tb.totals.closingDebitCents, true),
    amountCell(tb.totals.closingCreditCents, true),
  ]);
  sheet.push([]);
  sheet.push([
    textCell(
      tb.ties
        ? 'Opening, movement and closing columns each balance.'
        : 'A trial-balance column does not balance. The difference is shown, not adjusted.',
    ),
  ]);
  return sheet;
}

function partySheet(payload: StatementPayload, side: 'receivables' | 'payables'): SheetData {
  const block = payload.schedules[side];
  const sheet: SheetData = [
    [
      textCell(
        side === 'receivables' ? 'Accounts Receivable Statement' : 'Accounts Payable Statement',
        true,
      ),
    ],
    [textCell(`As at ${block.asAt}`)],
    [textCell(`Control accounts: ${block.controlAccountCodes.join(', ') || 'none'}`)],
    [],
    [
      textCell('Party', true),
      textCell('Reference', true),
      textCell('Current', true),
      textCell('31–60', true),
      textCell('61–90', true),
      textCell('Over 90', true),
      textCell('Balance', true),
      textCell('Last activity', true),
    ],
  ];
  for (const row of block.rows) {
    sheet.push([
      textCell(row.name),
      textCell(row.reference ?? ''),
      amountCell(row.currentCents),
      amountCell(row.days30Cents),
      amountCell(row.days60Cents),
      amountCell(row.over90Cents),
      amountCell(row.balanceCents),
      textCell(row.lastActivity ?? ''),
    ]);
  }
  sheet.push([
    textCell('Totals', true),
    textCell(''),
    amountCell(block.totals.currentCents, true),
    amountCell(block.totals.days30Cents, true),
    amountCell(block.totals.days60Cents, true),
    amountCell(block.totals.over90Cents, true),
    amountCell(block.totals.balanceCents, true),
    textCell(''),
  ]);
  sheet.push([]);
  sheet.push([textCell(`Control accounts: ${formatKes(cents(block.controlCents))}`)]);
  sheet.push([textCell(`Party balances: ${formatKes(cents(block.totalCents))}`)]);
  sheet.push([textCell(`Unallocated lines: ${formatKes(cents(block.unallocatedCents))}`)]);
  sheet.push([
    textCell(
      block.differenceCents === '0'
        ? 'The statement reconciles to the control accounts.'
        : `Difference: ${formatKes(cents(block.differenceCents))} — shown, not adjusted.`,
    ),
  ]);
  return sheet;
}

function fixedAssetSheet(payload: StatementPayload): SheetData {
  const block = payload.schedules.fixedAssets;
  const sheet: SheetData = [
    [textCell('Fixed Asset Register and Depreciation Schedule', true)],
    [textCell(`As at ${block.asAt}`)],
    [],
    [
      textCell('Code', true),
      textCell('Asset', true),
      textCell('Category', true),
      textCell('Acquired', true),
      textCell('Status', true),
      textCell('Cost', true),
      textCell('Accumulated depreciation', true),
      textCell('Net book value', true),
      textCell('Charge this period', true),
    ],
  ];
  for (const asset of block.rows) {
    sheet.push([
      textCell(asset.assetCode),
      textCell(asset.assetName),
      textCell(asset.category),
      textCell(asset.acquisitionDate),
      textCell(asset.status),
      amountCell(asset.costCents),
      amountCell(asset.accumulatedCents),
      amountCell(asset.netBookValueCents),
      amountCell(asset.periodChargeCents),
    ]);
  }
  const rec = block.reconciliation;
  sheet.push([
    textCell('Totals', true),
    textCell(''),
    textCell(''),
    textCell(''),
    textCell(''),
    amountCell(block.totals.costCents, true),
    amountCell(block.totals.accumulatedCents, true),
    amountCell(block.totals.netBookValueCents, true),
    amountCell(block.totals.periodChargeCents, true),
  ]);
  sheet.push([]);
  sheet.push([textCell('Register versus ledger', true)]);
  sheet.push([textCell(`Register cost: ${formatKes(cents(rec.registerCostCents))}`)]);
  sheet.push([textCell(`PPE control: ${formatKes(cents(rec.ledgerCostCents))}`)]);
  sheet.push([textCell(`Cost difference: ${formatKes(cents(rec.costDifferenceCents))}`)]);
  sheet.push([textCell(`Register accumulated: ${formatKes(cents(rec.registerAccumulatedCents))}`)]);
  sheet.push([textCell(`Control accumulated: ${formatKes(cents(rec.ledgerAccumulatedCents))}`)]);
  sheet.push([
    textCell(`Accumulated difference: ${formatKes(cents(rec.accumulatedDifferenceCents))}`),
  ]);
  sheet.push([
    textCell(`Posted batches: ${rec.batchesPosted} (${formatKes(cents(rec.batchChargeCents))})`),
  ]);
  sheet.push([textCell(`Ledger charge: ${formatKes(cents(rec.ledgerChargeCents))}`)]);
  sheet.push([textCell(`Charge difference: ${formatKes(cents(rec.chargeDifferenceCents))}`)]);
  return sheet;
}

function cashbookSheet(payload: StatementPayload): SheetData {
  const block = payload.schedules.cashbook;
  const sheet: SheetData = [
    [textCell('Cashbook and Bank Statements', true)],
    [textCell(`${block.periodStart} to ${block.periodEnd}`)],
    [],
    [
      textCell('Account', true),
      textCell('GL account', true),
      textCell('Opening', true),
      textCell('Receipts', true),
      textCell('Payments', true),
      textCell('Closing', true),
      textCell('Bank book balance', true),
      textCell('Difference', true),
    ],
  ];
  for (const account of block.accounts) {
    sheet.push([
      textCell(account.name),
      textCell(`${account.glAccountCode} ${account.glAccountName}`),
      amountCell(account.ledgerOpeningCents),
      amountCell(account.receiptsCents),
      amountCell(account.paymentsCents),
      amountCell(account.ledgerClosingCents),
      account.storedBookBalanceCents === null
        ? textCell('—')
        : amountCell(account.storedBookBalanceCents),
      account.differenceCents === null ? textCell('—') : amountCell(account.differenceCents),
    ]);
  }
  sheet.push([
    textCell('Totals', true),
    textCell(''),
    amountCell(block.totals.openingCents, true),
    amountCell(block.totals.receiptsCents, true),
    amountCell(block.totals.paymentsCents, true),
    amountCell(block.totals.closingCents, true),
    textCell(''),
    textCell(''),
  ]);
  return sheet;
}

function generalLedgerSheet(payload: StatementPayload): SheetData {
  const ledger = payload.schedules.generalLedger;
  const sheet: SheetData = [
    [textCell('General Ledger', true)],
    [textCell(`${ledger.periodStart} to ${ledger.periodEnd}`)],
    [],
    [
      textCell('Account', true),
      textCell('Date', true),
      textCell('Journal', true),
      textCell('Description', true),
      textCell('Source', true),
      textCell('Debit', true),
      textCell('Credit', true),
      textCell('Running', true),
    ],
  ];
  for (const account of ledger.accounts) {
    sheet.push([textCell(`${account.accountCode} ${account.accountName}`, true)]);
    sheet.push([
      textCell('Opening balance'),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      amountCell(account.openingCents),
    ]);
    for (const line of account.lines) {
      sheet.push([
        textCell(''),
        textCell(line.entryDate),
        textCell(line.journalNumber),
        textCell(line.description),
        textCell(line.sourceType),
        amountCell(line.debitCents),
        amountCell(line.creditCents),
        amountCell(line.runningCents),
      ]);
    }
    sheet.push([
      textCell('Closing balance', true),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      textCell(''),
      amountCell(account.closingCents, true),
    ]);
    sheet.push([]);
  }
  return sheet;
}

function checksSheet(payload: StatementPayload): SheetData {
  const sheet: SheetData = [
    [textCell('Reconciliation and Validation Checks', true)],
    [],
    [
      textCell('Code', true),
      textCell('Check', true),
      textCell('Status', true),
      textCell('Detail', true),
    ],
  ];
  for (const check of payload.checks) {
    sheet.push([
      textCell(check.code),
      textCell(check.label),
      textCell(check.status),
      textCell(check.detail),
    ]);
  }
  if (payload.notes.length) {
    sheet.push([]);
    sheet.push([textCell('Management notes', true)]);
    sheet.push([
      textCell('Ref', true),
      textCell('Title', true),
      textCell('Body', true),
      textCell('Author', true),
    ]);
    for (const note of payload.notes) {
      sheet.push([
        textCell(note.noteRef),
        textCell(note.title),
        textCell(note.body),
        textCell(`${note.authorName ?? note.authorUserId ?? 'unknown'} at ${note.recordedAt}`),
      ]);
    }
  }
  return sheet;
}

function buildSheets(payload: StatementPayload, meta: ExportMeta, statement: ExportStatement) {
  const sheets: Array<{ name: string; data: SheetData }> = [];
  const add = (name: string, data: SheetData) => sheets.push({ name: name.slice(0, 31), data });
  const all = statement === 'ALL';

  if (all || statement === 'financialPosition')
    add(
      'Financial Position',
      blockSheet(
        'Statement of Financial Position',
        payload,
        payload.statements.financialPosition,
        meta,
      ),
    );
  if (all || statement === 'incomeStatement')
    add(
      'Income Statement',
      blockSheet('Income Statement', payload, payload.statements.incomeStatement, meta),
    );
  if (all || statement === 'cashFlows')
    add(
      'Cash Flows',
      blockSheet('Statement of Cash Flows', payload, payload.statements.cashFlows, meta),
    );
  if (all || statement === 'changesInEquity')
    add('Changes in Equity', equitySheet(payload, payload.statements.changesInEquity, meta));
  if (all || statement === 'trialBalance') add('Trial Balance', trialBalanceSheet(payload));
  if (all || statement === 'cashbook') add('Cashbook', cashbookSheet(payload));
  if (all || statement === 'receivables') add('Receivables', partySheet(payload, 'receivables'));
  if (all || statement === 'payables') add('Payables', partySheet(payload, 'payables'));
  if (all || statement === 'fixedAssets') add('Fixed Assets', fixedAssetSheet(payload));
  if (statement === 'generalLedger') add('General Ledger', generalLedgerSheet(payload));
  if (all) add('Checks and Notes', checksSheet(payload));
  return sheets;
}

async function excel(
  payload: StatementPayload,
  meta: ExportMeta,
  statement: ExportStatement,
): Promise<Buffer> {
  const sheets = buildSheets(payload, meta, statement);
  return writeXlsxFile(sheets.map((sheet) => ({ data: sheet.data, sheet: sheet.name }))).toBuffer();
}

/* ============================================================
   Entry point
   ============================================================ */

function filename(
  payload: StatementPayload,
  format: ExportFormat,
  statement: ExportStatement,
): string {
  const facility = payload.meta.facilityName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const slug =
    statement === 'ALL'
      ? 'financial-statements'
      : statement
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase()
          .replace(/^-/, '');
  return `${facility}-${slug}-${payload.meta.periodEnd}.${format}`;
}

export async function exportStatements(
  payload: StatementPayload,
  format: ExportFormat,
  statement: ExportStatement,
  meta: ExportMeta,
): Promise<ExportOutput> {
  if (!['pdf', 'xlsx'].includes(format)) {
    throw new Error(`Unsupported export format "${String(format)}".`);
  }
  if (statement !== 'ALL' && !(statement in TITLES)) {
    throw new Error(`Unknown statement "${String(statement)}".`);
  }

  const bytes =
    format === 'pdf'
      ? await pdfDocument({ payload, meta, statement })
      : await excel(payload, meta, statement);

  if (!bytes.length) throw new Error('The export produced no content.');

  return {
    filename: filename(payload, format, statement),
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
    byteLength: bytes.length,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

export { TITLES as STATEMENT_TITLES };
export const EXPORT_STATEMENTS = Object.keys(TITLES) as Array<Exclude<ExportStatement, 'ALL'>>;
