import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { BillingInvoice, BillingItem, Patient } from '../../types/index.ts';
import {
  Receipt,
  CheckCircle2,
  DollarSign,
  CreditCard,
  Smartphone,
  Printer,
  Search,
  Eye,
  Plus
} from 'lucide-react';

export const BillingCashierModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'M-Pesa' | 'Cash' | 'Card' | 'SHA/NHIF'>('M-Pesa');
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [mpesaPhone, setMpesaPhone] = useState('+254 700 000 000');
  const [referenceCode, setReferenceCode] = useState('');
  const [isSimulatingStk, setIsSimulatingStk] = useState(false);

  useEffect(() => {
    async function loadBilling() {
      setLoading(true);
      try {
        const [inv, pList] = await Promise.all([
          api.getInvoices(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setInvoices(inv);
        setPatients(pList);
        if (inv.length > 0 && !selectedInvoice) {
          selectInvoice(inv[0]);
        }
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        setLoading(false);
      }
    }
    loadBilling();
  }, [currentFacility, refreshKey]);

  const selectInvoice = async (inv: BillingInvoice) => {
    setSelectedInvoice(inv);
    try {
      const items = await api.getInvoiceItems(inv.id);
      setInvoiceItems(items);
    } catch (err) {
      console.error('Failed to load line items:', err);
    }
  };

  const openPaymentModal = (inv: BillingInvoice) => {
    setSelectedInvoice(inv);
    setPaymentAmount(inv.balanceAmount || inv.totalAmount || '0');
    setReferenceCode(`MPESA-${Math.random().toString(36).substring(2, 9).toUpperCase()}`);
    setIsPaymentModalOpen(true);
  };

  const handleSimulateStkPush = () => {
    setIsSimulatingStk(true);
    setTimeout(() => {
      setIsSimulatingStk(false);
      showToast('Safaricom STK Push received on customer handset! PIN verified.');
    }, 1500);
  };

  const handleRecordPayment = async () => {
    if (!selectedInvoice) return;

    try {
      const receiptNo = `REC-${Date.now().toString().slice(-6)}`;
      await api.recordPayment({
        invoiceId: selectedInvoice.id,
        receiptNumber: receiptNo,
        paymentMethod,
        amount: paymentAmount,
        referenceCode: paymentMethod === 'M-Pesa' ? referenceCode : undefined,
        cashierName: currentUser.name,
      });

      showToast(`Payment of KES ${Number(paymentAmount).toLocaleString()} recorded. Receipt: ${receiptNo}`);
      setIsPaymentModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Payment failed: ${err.message}`);
    }
  };

  const getPatient = (patientId: number) => {
    return patients.find(p => p.id === patientId);
  };

  const totalOutstanding = invoices.reduce((acc, i) => acc + Number(i.balanceAmount || 0), 0);
  const totalCollections = invoices.reduce((acc, i) => acc + Number(i.paidAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Patient Billing, Cashier POS & Receipts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            M-Pesa STK push integration, Cash reconciliation, tariff charging, and official medical receipting.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xs text-slate-400 uppercase font-semibold">Today's Collections</div>
            <div className="font-mono font-bold text-base text-teal-800">
              KES {totalCollections.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">Total Invoices</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{invoices.length}</div>
          <div className="text-2xs text-slate-500 mt-1">Active billing accounts</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-rose-700 font-semibold tracking-wider">Outstanding Patient Balances</span>
          <div className="text-2xl font-bold font-mono text-rose-700 mt-1">
            KES {totalOutstanding.toLocaleString()}
          </div>
          <div className="text-2xs text-slate-500 mt-1">Unsettled or pending clearance</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-teal-800 font-semibold tracking-wider">Active Cashier Workstation</span>
          <div className="text-sm font-bold text-slate-900 mt-1">{currentUser.name}</div>
          <div className="text-2xs text-slate-500 mt-1">{currentUser.role} · Shift Open</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Invoices List (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-teal-700" />
              <span>Patient Invoices ({invoices.length})</span>
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Real-Time Ledger</span>
          </div>

          <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[600px]">
            {invoices.map((inv) => {
              const patient = getPatient(inv.patientId);
              const isSelected = selectedInvoice?.id === inv.id;
              const hasBalance = Number(inv.balanceAmount || 0) > 0;

              return (
                <div
                  key={inv.id}
                  onClick={() => selectInvoice(inv)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 text-xs">{inv.invoiceNumber}</span>
                    <span className={`px-2 py-0.5 rounded text-3xs font-medium ${
                      inv.status === 'Paid'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-800'
                    }`}>
                      {inv.status}
                    </span>
                  </div>

                  <div className="text-2xs text-slate-600 mt-1">
                    Patient: <strong>{patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${inv.patientId}`}</strong> ({patient?.mrn})
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-xs font-mono">
                    <span className="text-slate-500">Total: KES {Number(inv.totalAmount).toLocaleString()}</span>
                    <span className={hasBalance ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                      Bal: KES {Number(inv.balanceAmount).toLocaleString()}
                    </span>
                  </div>

                  {hasBalance && (
                    <div className="mt-2 pt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openPaymentModal(inv);
                        }}
                        className="w-full py-1 bg-teal-700 text-white text-2xs font-semibold rounded hover:bg-teal-800 transition-colors shadow-xs"
                      >
                        Accept Payment (M-Pesa / Cash)
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Two Columns: Invoice Detail & Line Items Breakdown (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {selectedInvoice ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-xs space-y-5">
              {/* Receipt Header Style */}
              <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">{selectedInvoice.invoiceNumber}</h2>
                    <span className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                      selectedInvoice.status === 'Paid' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                    }`}>
                      {selectedInvoice.status}
                    </span>
                  </div>
                  <div className="text-2xs text-slate-500 mt-0.5">
                    Facility: {currentFacility?.name} · MFL: <strong className="font-mono text-teal-800">{currentFacility?.mflCode}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {Number(selectedInvoice.balanceAmount || 0) > 0 && (
                    <button
                      onClick={() => openPaymentModal(selectedInvoice)}
                      className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
                    >
                      Receive Payment
                    </button>
                  )}
                </div>
              </div>

              {/* Patient and Payer details */}
              {(() => {
                const pat = getPatient(selectedInvoice.patientId);
                return (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-2xs">
                    <div>
                      <span className="text-slate-400 block uppercase font-medium">Billed Patient</span>
                      <strong className="text-slate-800 text-xs">{pat?.firstName} {pat?.lastName}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block uppercase font-medium">Medical Record #</span>
                      <strong className="font-mono text-slate-800 text-xs">{pat?.mrn}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block uppercase font-medium">Payer Scheme</span>
                      <strong className="text-slate-800 text-xs">{selectedInvoice.payerType}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block uppercase font-medium">Invoice Date</span>
                      <strong className="font-mono text-slate-800 text-xs">
                        {new Date(selectedInvoice.createdAt).toLocaleDateString()}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              {/* Line Items Table */}
              <div>
                <h3 className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Itemized Tariff & Service Charges
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-2xs text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Item Description</th>
                        <th className="px-4 py-2.5 font-medium">Department</th>
                        <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                        <th className="px-4 py-2.5 font-medium text-right">Unit Price</th>
                        <th className="px-4 py-2.5 font-medium text-right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {invoiceItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-sans font-medium text-slate-900">{item.description}</td>
                          <td className="px-4 py-2.5 font-sans text-slate-600">{item.itemType}</td>
                          <td className="px-4 py-2.5 text-right">{item.quantity}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">
                            KES {Number(item.unitPrice).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                            KES {Number(item.totalAmount).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Totals Strip */}
              <div className="flex justify-end pt-2">
                <div className="w-64 space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span>KES {Number(selectedInvoice.totalAmount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <span>Paid to Date:</span>
                    <span>KES {Number(selectedInvoice.paidAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                    <span>Balance Due:</span>
                    <span className="text-rose-700">KES {Number(selectedInvoice.balanceAmount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
              Select an invoice from the ledger to view itemized breakdown and collect payment.
            </div>
          )}
        </div>
      </div>

      {/* PAYMENT MODAL (M-PESA / CASH / CARD) */}
      {isPaymentModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Hospital Cashier Payment Processing</h3>
                <p className="text-2xs text-slate-500">Invoice: {selectedInvoice.invoiceNumber}</p>
              </div>
              <span className="font-mono font-bold text-sm text-teal-800">
                KES {Number(selectedInvoice.balanceAmount).toLocaleString()} Due
              </span>
            </div>

            {/* Payment Method Tabs */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'M-Pesa', label: 'M-Pesa', icon: Smartphone },
                { id: 'Cash', label: 'Cash', icon: DollarSign },
                { id: 'Card', label: 'Visa/MC', icon: CreditCard },
                { id: 'SHA/NHIF', label: 'SHA Claim', icon: Receipt },
              ].map((pm) => {
                const Icon = pm.icon;
                const isSelected = paymentMethod === pm.id;

                return (
                  <button
                    key={pm.id}
                    onClick={() => setPaymentMethod(pm.id as any)}
                    className={`py-2 px-1 rounded-lg border text-center font-medium flex flex-col items-center gap-1 transition-all ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50/50 text-teal-900 font-semibold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 text-teal-700" />
                    <span>{pm.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount to Pay (KES) *</label>
                <input
                  type="text"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold text-base text-slate-900"
                />
              </div>

              {paymentMethod === 'M-Pesa' && (
                <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-lg space-y-2">
                  <div className="font-semibold text-emerald-950 flex items-center justify-between">
                    <span>Safaricom M-Pesa Express / STK Push</span>
                    <span className="font-mono text-2xs text-emerald-800">Paybill: 883921</span>
                  </div>
                  <div>
                    <label className="block text-2xs text-slate-600 mb-0.5">Customer Mobile Number</label>
                    <input
                      type="text"
                      value={mpesaPhone}
                      onChange={(e) => setMpesaPhone(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-emerald-300 rounded font-mono font-semibold"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      disabled={isSimulatingStk}
                      onClick={handleSimulateStkPush}
                      className="px-3 py-1.5 bg-emerald-700 text-white rounded text-2xs font-semibold hover:bg-emerald-800 transition-colors shadow-xs"
                    >
                      {isSimulatingStk ? 'Sending STK Push...' : 'Send STK Prompt to Phone'}
                    </button>
                    <span className="font-mono text-2xs text-slate-500">Ref: {referenceCode}</span>
                  </div>
                </div>
              )}

              {paymentMethod === 'Cash' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-2xs text-slate-600">
                  Physical currency counted at Cashier Station. Automatic change calculation and receipt printing.
                </div>
              )}

              {paymentMethod === 'SHA/NHIF' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-2xs text-blue-900">
                  Covered under Social Health Authority (SHA) benefits. Direct electronic claim will be submitted to the SHA portal.
                </div>
              )}
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordPayment}
                className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 transition-colors shadow-xs"
              >
                Confirm Payment & Issue Official Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
