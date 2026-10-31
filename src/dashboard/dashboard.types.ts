import type { DashboardRange } from './date-range.ts';

export type DashboardPanel<T> =
  { status: 'ok'; data: T } | { status: 'restricted' | 'disabled' | 'error'; message: string };

export interface DashboardBucket extends DashboardRange {
  value: number;
}

export interface DashboardOverview {
  facilityId: number;
  range: DashboardRange;
  previousRange: DashboardRange;
  registrations: DashboardPanel<{
    current: number;
    previous: number;
    totalThroughEnd: number;
    trend: DashboardBucket[];
  }>;
  receipts: DashboardPanel<{
    gross: string;
    refunds: string;
    net: string;
    previousNet: string;
    trend: Array<DashboardRange & { net: string }>;
  }>;
  invoices: DashboardPanel<{
    current: number;
    previous: number;
    billed: string;
    recordedBalance: string;
    finalized: number;
    categories: Array<{ label: string; amount: string }>;
  }>;
  admissions: DashboardPanel<{ current: number; previous: number }>;
  flow: DashboardPanel<Array<DashboardRange & { registered: number; returning: number }>>;
  activity: DashboardPanel<Array<{ id: number; action: string; resource: string; at: string }>>;
  appointments: DashboardPanel<
    Array<{
      id: number;
      patientName: string;
      scheduledTime: string;
      appointmentType: string | null;
      practitionerName: string | null;
      status: string | null;
    }>
  >;
}

export interface DashboardSearchResult {
  patients: Array<{ id: number; name: string; mrn: string }>;
  invoices: Array<{ id: number; number: string; status: string | null }>;
  services: Array<{ id: number; code: string; description: string }>;
  /** Kinds omitted for lack of permission/module are explicit, not empty matches. */
  available: { patients: boolean; invoices: boolean; services: boolean };
}
