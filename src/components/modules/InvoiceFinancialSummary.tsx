import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { parseMoneyToCents } from '../../billing/settlement.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import type { BillingInvoice } from '../../types/index.ts';

const money = (cents: number) =>
  `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Receipt/refund totals are not revenue or proof of an external transfer. */
export const InvoiceFinancialSummary: React.FC<{ invoice: BillingInvoice }> = ({ invoice }) => {
  const { refreshKey } = useHmis();
  const [summary, setSummary] = useState<{
    gross: number;
    refunds: number;
    net: number;
    subtotal: number;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSummary(null);
    setError('');
    api
      .getInvoiceDetail(invoice.id)
      .then((detail) => {
        if (!active) return;
        const sum = (values: Array<string | number | null | undefined>): number | null => {
          let total = 0;
          for (const value of values) {
            const cents = parseMoneyToCents(value);
            if (cents === null || cents < 0 || !Number.isSafeInteger(total + cents)) return null;
            total += cents;
          }
          return total;
        };
        if (
          detail.invoice.id !== invoice.id ||
          !Array.isArray(detail.items) ||
          !Array.isArray(detail.payments) ||
          !Array.isArray(detail.refunds)
        ) {
          setError('Receipt and adjustment details are unavailable.');
          return;
        }
        const gross = sum(detail.payments.map((p) => p.amount)),
          refunds = sum(detail.refunds.map((r) => r.amount)),
          subtotal = sum(detail.items.map((i) => i.totalAmount));
        const header = parseMoneyToCents(detail.invoice.paidAmount),
          total = parseMoneyToCents(detail.invoice.totalAmount);
        if (
          gross === null ||
          refunds === null ||
          subtotal === null ||
          header === null ||
          total === null ||
          refunds > gross ||
          gross - refunds !== header ||
          subtotal !== total
        ) {
          setError(
            'Invoice and receipt totals require reconciliation; do not assume missing amounts are zero.',
          );
          return;
        }
        setSummary({ gross, refunds, net: gross - refunds, subtotal });
      })
      .catch(() => {
        if (active)
          setError(
            'Receipt history is unavailable. Do not assume there are no payments or refunds.',
          );
      });
    return () => {
      active = false;
    };
  }, [invoice.id, refreshKey]);
  return (
    <div className="flex justify-end pt-2">
      <div className="w-80 space-y-1.5 text-xs font-mono">
        {error ? (
          <p role="alert" className="text-rose-800">
            {error}
          </p>
        ) : !summary ? (
          <p role="status">Loading receipt totals…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span>Item subtotal</span>
              <span>{money(summary.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Recorded payments</span>
              <span>{money(summary.gross)}</span>
            </div>
            <div className="flex justify-between">
              <span>Recorded refunds</span>
              <span>{money(summary.refunds)}</span>
            </div>
            <div className="flex justify-between">
              <span>Net receipts</span>
              <span>{money(summary.net)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between">
          <span>Item adjustments/reversals</span>
          <span>Not available</span>
        </div>
        <div className="flex justify-between font-bold border-t pt-1">
          <span>Outstanding balance</span>
          <span>
            {parseMoneyToCents(invoice.balanceAmount) === null
              ? 'Unavailable'
              : money(parseMoneyToCents(invoice.balanceAmount)!)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Patient credit</span>
          <span>
            {parseMoneyToCents(invoice.creditBalance) === null
              ? 'Unavailable'
              : money(parseMoneyToCents(invoice.creditBalance)!)}
          </span>
        </div>
        <p className="font-sans text-slate-500">
          Recorded receipts and refunds are not recognized revenue or proof of external settlement.
          Item-level adjustments require a separate controlled workflow.
        </p>
      </div>
    </div>
  );
};
