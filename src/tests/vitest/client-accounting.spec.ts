import { describe, expect, it } from 'vitest';
import {
  centsToKes,
  parseKesToCents,
  requireIsoDate,
  validateBalancedJournalLines,
} from '../../accounting/accounting.service.ts';
import {
  calculateReconciliation,
  parseBankStatementCsv,
  UnconfiguredBankConnector,
} from '../../accounting/bank-integration.service.ts';

describe('accounting safety primitives', () => {
  it('uses exact decimal arithmetic without rounding invalid amounts', () => {
    expect(parseKesToCents('100.05')).toBe(10005n);
    expect(centsToKes(-10005n)).toBe('-100.05');
    for (const value of ['1.999', '-1', '1e4', '1,000.00', '', NaN]) {
      expect(() => parseKesToCents(value)).toThrow();
    }
    expect(() => requireIsoDate('2026-02-30')).toThrow();
    expect(requireIsoDate('2026-02-28')).toBe('2026-02-28');
  });

  it('requires at least two one-sided lines with equal totals', () => {
    expect(
      validateBalancedJournalLines([
        { accountId: 1, debitKes: '0.29' },
        { accountId: 2, creditKes: '0.29' },
      ]).totalCents,
    ).toBe(29n);
    expect(() => validateBalancedJournalLines([{ accountId: 1, debitKes: '1.00' }])).toThrow();
    expect(() =>
      validateBalancedJournalLines([
        { accountId: 1, debitKes: '1.00', creditKes: '1.00' },
        { accountId: 2, debitKes: '1.00' },
      ]),
    ).toThrow();
    expect(() =>
      validateBalancedJournalLines([
        { accountId: 1, debitKes: '1.00' },
        { accountId: 2, creditKes: '0.99' },
      ]),
    ).toThrow();
  });
});

describe('bank statement primitives', () => {
  it('parses quoted CSV safely and rejects unknown direction', () => {
    const rows = parseBankStatementCsv(
      'date,reference,description,direction,amount\n2026-10-01,ABC,"Fee, October",OUTFLOW,10.00\n',
    );
    expect(rows).toEqual([
      {
        transactionDate: '2026-10-01',
        referenceNumber: 'ABC',
        description: 'Fee, October',
        direction: 'OUTFLOW',
        amountKes: '10.00',
      },
    ]);
    expect(() =>
      parseBankStatementCsv(
        'date,reference,description,direction,amount\n2026-10-01,ABC,Fee,UNKNOWN,10.00',
      ),
    ).toThrow();
    expect(() =>
      parseBankStatementCsv(
        'date,reference,description,direction,amount\n2026-10-01,ABC,"bad,OUTFLOW,10.00',
      ),
    ).toThrow();
  });
  it('balances a worksheet without claiming a bank confirmation', async () => {
    expect(
      calculateReconciliation({
        statementBalanceCents: 9000n,
        ledgerBalanceCents: 10000n,
        unmatchedLedgerInflowsCents: 1000n,
        unmatchedLedgerOutflowsCents: 0n,
        unmatchedStatementInflowsCents: 0n,
        unmatchedStatementOutflowsCents: 0n,
      }),
    ).toMatchObject({ differenceKes: '0.00', worksheetBalanced: true, bankConfirmed: false });
    const result = await new UnconfiguredBankConnector().fetchStatement();
    expect(result.status).toBe('UNAVAILABLE');
  });
});
