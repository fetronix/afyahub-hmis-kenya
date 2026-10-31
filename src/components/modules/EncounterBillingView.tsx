import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { parseMoneyToCents } from '../../billing/settlement.ts';
import { InvoiceFinancialSummary } from './InvoiceFinancialSummary.tsx';
import type { BillingInvoice, BillingItem } from '../../types/index.ts';

type Detail = { invoice: BillingInvoice; items: BillingItem[] };
const money = (value: string | number | null | undefined) => {
  const cents = parseMoneyToCents(value);
  return cents === null ? 'Unavailable' : `KES ${(cents / 100).toFixed(2)}`;
};

/** Read-only encounter view of existing invoice snapshots; no new billing ledger. */
export const EncounterBillingView: React.FC<{
  facilityId: number;
  patientId: number;
  encounterId: number;
}> = ({ facilityId, patientId, encounterId }) => {
  const { refreshKey } = useHmis();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Detail[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataScope, setDataScope] = useState('');
  const scope = `${facilityId}:${patientId}:${encounterId}`;
  const currentScope = scope === dataScope;
  useEffect(() => {
    if (!open) return;
    let current = true;
    setDataScope(scope);
    setLoading(true);
    setError('');
    setDetails([]);
    api
      .getInvoices(facilityId, patientId)
      .then(async (invoices) => {
        if (
          !Array.isArray(invoices) ||
          invoices.some(
            (invoice) =>
              !invoice ||
              !Number.isSafeInteger(invoice.id) ||
              !Number.isSafeInteger(invoice.facilityId) ||
              !Number.isSafeInteger(invoice.patientId) ||
              (invoice.encounterId !== null && !Number.isSafeInteger(invoice.encounterId)),
          )
        )
          throw new Error('Invalid invoice list');
        const matching = invoices.filter(
          (invoice) =>
            invoice.facilityId === facilityId &&
            invoice.patientId === patientId &&
            invoice.encounterId === encounterId,
        );
        const result = await Promise.all(
          matching.map((invoice) => api.getInvoiceDetail(invoice.id)),
        );
        if (
          result.some(
            (item, index) =>
              item.invoice.id !== matching[index].id ||
              item.invoice.facilityId !== facilityId ||
              item.invoice.patientId !== patientId ||
              item.invoice.encounterId !== encounterId ||
              !Array.isArray(item.items) ||
              item.items.some((line) => line.invoiceId !== item.invoice.id),
          )
        )
          throw new Error('Invoice scope mismatch');
        if (current) setDetails(result);
      })
      .catch(() => {
        if (current)
          setError(
            'Encounter invoices are unavailable. Do not assume there is no balance or payment.',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, facilityId, patientId, encounterId, refreshKey, scope]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-slate-200 bg-white p-4 text-xs"
    >
      <summary className="cursor-pointer font-semibold">Encounter billing and receipts</summary>
      {open && (
        <div className="mt-3 space-y-4">
          {(loading || !currentScope) && <p role="status">Loading encounter invoices…</p>}
          {currentScope && error && (
            <p role="alert" className="text-rose-700">
              {error}
            </p>
          )}
          {currentScope && !loading && !error && !details.length && (
            <p>
              No invoice linked to this encounter was returned. Uncompleted orders are not charges.
            </p>
          )}
          {currentScope &&
            !loading &&
            !error &&
            details.map(({ invoice, items }) => (
              <section key={invoice.id} className="space-y-2">
                <h3 className="font-semibold">
                  {invoice.invoiceNumber} · {invoice.status}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left">
                    <thead>
                      <tr>
                        <th>Service / code / department</th>
                        <th>Quantity / unit</th>
                        <th>Unit price</th>
                        <th>Total</th>
                        <th>Source / date / status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td>
                            {item.description}
                            <br />
                            {item.serviceCode ?? item.tariffCode ?? 'Code not recorded'} ·{' '}
                            {item.serviceDepartment ?? item.itemType ?? 'Department not recorded'}
                          </td>
                          <td>
                            {item.quantity ?? 'Quantity not recorded'}{' '}
                            {item.serviceUnit ?? 'unit not recorded'}
                          </td>
                          <td>{money(item.unitPrice)}</td>
                          <td>{money(item.totalAmount)}</td>
                          <td>
                            {item.sourceType
                              ? `${item.sourceType}${item.sourceId == null ? '' : ` #${item.sourceId}`}`
                              : 'Source not recorded'}
                            <br />
                            {item.serviceDate ??
                              item.servicePerformedAt ??
                              'Date not recorded'} ·{' '}
                            {invoice.status?.toLowerCase() === 'void' ? 'Invoice void' : 'Recorded'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <InvoiceFinancialSummary invoice={invoice} />
              </section>
            ))}
        </div>
      )}
    </details>
  );
};
