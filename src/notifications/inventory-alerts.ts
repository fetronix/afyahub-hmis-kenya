import { daysUntilExpiry } from '../inventory/inventory-contracts.ts';
import type { AlertGroup, InboxItem, NotificationSeverity } from './inbox.types.ts';

/** Facility-calendar horizons; 8–10 day lots remain visible in the 30-day warning tier. */
export const EXPIRY_CRITICAL_DAYS = 7;
export const EXPIRY_WARNING_DAYS = 30;
type Candidate = Omit<InboxItem, 'key' | 'at' | 'timeKind' | 'read'> & {
  sourceKey: string;
  fingerprint: string;
};

export function expiryCandidates(
  rows: Array<{
    id: number;
    name: string;
    batch_number: string;
    expiry_date: string;
    quantity_remaining: number;
    unit: string | null;
  }>,
  today: string,
  facilityName: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const batch of rows) {
    if (batch.quantity_remaining <= 0) continue;
    const days = daysUntilExpiry(batch.expiry_date, today);
    let group: AlertGroup;
    let severity: NotificationSeverity;
    let title: string;
    let when: string;
    if (days === null) {
      group = 'inventoryReview';
      severity = 'WARNING';
      title = 'Batch expiry requires review';
      when = 'Invalid expiry date; days remaining unavailable';
    } else if (days < 0) {
      group = 'expired';
      severity = 'CRITICAL';
      title = 'Expired stock';
      when = `Expired ${Math.abs(days)} day${days === -1 ? '' : 's'} ago`;
    } else if (days <= EXPIRY_CRITICAL_DAYS) {
      group = 'expiry7';
      severity = 'CRITICAL';
      title = 'Stock expires within 7 days';
      when = days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} remaining`;
    } else if (days <= EXPIRY_WARNING_DAYS) {
      group = 'expiry30';
      severity = 'WARNING';
      title = 'Stock expires within 30 days';
      when = `${days} days remaining`;
    } else continue;
    candidates.push({
      sourceKey: `inventory.expiry:${batch.id}`,
      fingerprint: `${group}:${batch.expiry_date}`,
      group,
      severity,
      title,
      details: `${batch.name} · batch ${batch.batch_number} · expiry ${batch.expiry_date} · ${batch.quantity_remaining} ${batch.unit || 'units'} · ${facilityName} · ${when}.`,
      source: 'Inventory batches',
      destination: 'inventory',
      isAlert: true,
    });
  }
  return candidates;
}
