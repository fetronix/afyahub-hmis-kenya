import type { Settlement } from './settlement.ts';

/** Historical, minimum-necessary invoice facts recorded at finalization. */
export interface InvoiceSnapshot {
  version: 1;
  invoice: {
    id: number;
    number: string;
    createdAt: string;
    payerType: string | null;
    payerName: string | null;
    memberNumber: string | null;
  };
  facility: {
    name: string;
    internalCode: string;
    registryCode: string;
    address: string;
    county: string;
    phone: string | null;
    email: string | null;
  };
  patient: { id: number; name: string; mrn: string };
  encounter: {
    id: number;
    department: string;
    attendingClinician: string;
    diagnoses: Array<{ system: string; code: string; description: string; type: string | null }>;
  };
  items: Array<{
    id: number;
    tariffId: number;
    code: string;
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
    sourceType: string | null;
  }>;
  amounts: {
    itemizedTotal: string;
    /** The existing invoice system does not separately record these fields. */
    discounts: null;
    adjustments: null;
    patientResponsibility: string;
    insurerResponsibility: string;
    copayment: string;
    allocationBasis: string;
  };
}

export type PaymentParty = 'PATIENT' | 'INSURER';

export interface InvoiceFinancialView {
  /** False means the header and immutable receipt/refund ledger disagree. */
  reconciled: boolean;
  grossReceipts: string | null;
  refunds: string | null;
  netReceipts: string | null;
  invoiceBalance: string | null;
  invoiceCredit: string | null;
  patientNetReceipts: string | null;
  insurerNetReceipts: string | null;
  unattributedNetReceipts: string | null;
  /** Party balances are unknown while any net receipt remains unattributed. */
  patientBalance: string | null;
  insurerBalance: string | null;
  patientCredit: string | null;
  insurerCredit: string | null;
}

export interface FinalizedInvoiceView {
  finalized: true;
  finalizedAt: string;
  finalizedByUserId: number;
  voided: boolean;
  snapshot: InvoiceSnapshot;
  financial: InvoiceFinancialView;
  payments: Array<{
    id: number;
    receiptNumber: string;
    paymentMethod: string | null;
    amount: string;
    transactionCode: string | null;
    paymentDate: string;
    cashierName: string;
    party: PaymentParty | null;
  }>;
  refunds: Array<{
    id: number;
    paymentId: number;
    refundNumber: string;
    amount: string;
    refundMethod: string;
    createdAt: string;
  }>;
}

/** The original settlement returned on a safe retry of one receipt. */
export interface PaymentReplaySnapshot {
  settlement: Settlement;
  invoice: {
    id: number;
    invoiceNumber: string;
    totalAmount: string;
    paidAmount: string;
    balanceAmount: string;
    creditBalance: string;
    status: string;
  };
}
