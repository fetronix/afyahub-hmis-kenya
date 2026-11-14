export type NotificationSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
export type NotificationDestination =
  'inventory' | 'laboratory' | 'registration' | 'reception' | 'inpatient' | 'theatre' | 'finance';
export type AlertGroup =
  'expired' | 'expiry7' | 'expiry30' | 'stockout' | 'lowStock' | 'inventoryReview' | 'criticalLab';

export interface InboxItem {
  key: string;
  severity: NotificationSeverity;
  title: string;
  details: string;
  source: string;
  destination: NotificationDestination;
  /** Alert detection time is an instant; legacy source timestamps are stored wall time without a zone. */
  at: string;
  timeKind: 'detected' | 'recorded';
  isAlert: boolean;
  group?: AlertGroup;
  read: boolean;
}
export interface InboxResponse {
  facilityId: number;
  timezone: string;
  checkedAt: string;
  eventWindowDays: number;
  items: InboxItem[];
  total: number;
  unreadCount: number;
  unreadCritical: number;
  offset: number;
  limit: number;
  alertGroups: Array<{
    group: AlertGroup;
    severity: NotificationSeverity;
    count: number;
    destination: NotificationDestination;
  }>;
  availableSources: string[];
}
