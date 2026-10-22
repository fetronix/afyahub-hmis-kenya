/**
 * JaliCare HMIS
 * Round five — expiry, the revenue split, and the role save that vanished
 *
 * One suite for the five things asked for:
 *
 *   1. a stock expiry date on the Add form, and a countdown;
 *   2. an overview alert and record at ten days;
 *   3. money in separated into SHA, online mobile money and cash;
 *   4. the facility role save that reported success while the effective
 *      permissions never changed;
 *   5. the codes to use in a facility for billing.
 *
 * No database is required. The rules that decide money and colour are
 * pure functions, and the wiring is asserted against the source the
 * server and the screen actually run.
 *
 * Run with: npx tsx src/tests/round5.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PAYMENT_CHANNELS,
  PAYMENT_CHANNEL_LABELS,
  paymentChannel,
} from '../billing/settlement.ts';
import {
  countdownTo,
  expiryDeadline,
  expiryToneClass,
} from '../components/ExpiryCountdown.tsx';
import {
  daysUntilExpiry,
  expiryStatus,
} from '../inventory/inventory-contracts.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

/* ============================================================
   1. PAYMENT CHANNELS — SHA, online mobile money, cash
   ============================================================ */

function testPaymentChannels(): void {
  console.log('1. Money in is separated by the rail it arrived through');

  /* Order matters: the screen prints them in this order. */
  assertEqual(
    PAYMENT_CHANNELS,
    ['SHA', 'MOBILE_MONEY', 'CASH', 'CARD', 'OTHER'],
    'The split covers SHA, mobile money, cash, card and an honest other',
  );

  /* SHA is a payer. A claim settles into a payment row with method SHA. */
  assertEqual(paymentChannel('SHA'), 'SHA', 'SHA is its own channel');
  assertEqual(paymentChannel('sha'), 'SHA', 'SHA is matched case-insensitively');
  assertEqual(
    paymentChannel('SHA Claim'),
    'SHA',
    'A spaced SHA claim label still lands in SHA',
  );

  /* Online mobile money, however the till spelled it. */
  assertEqual(paymentChannel('M-Pesa'), 'MOBILE_MONEY', 'M-Pesa is mobile money');
  assertEqual(paymentChannel('MPESA'), 'MOBILE_MONEY', 'MPESA is mobile money');
  assertEqual(paymentChannel('m pesa'), 'MOBILE_MONEY', 'm pesa is mobile money');
  assertEqual(
    paymentChannel('Airtel Money'),
    'MOBILE_MONEY',
    'Airtel Money is mobile money',
  );

  assertEqual(paymentChannel('Cash'), 'CASH', 'Cash is its own channel');
  assertEqual(paymentChannel('CARD'), 'CARD', 'Card is not folded into cash');

  /*
   * A private insurer named "Insurance" is not SHA. Guessing it into the
   * SHA line would overstate public claims and understate the payer.
   */
  assertEqual(
    paymentChannel('Insurance'),
    'OTHER',
    'An unrecognised payer is not guessed into SHA',
  );
  assertEqual(paymentChannel(''), 'OTHER', 'An empty method is other');
  assertEqual(paymentChannel(null), 'OTHER', 'A missing method is other');

  assertEqual(
    PAYMENT_CHANNEL_LABELS.MOBILE_MONEY,
    'Online mobile money',
    'The mobile channel is labelled as the online rail',
  );

  /* The claims engine posts SHA through the payment table, not beside it. */
  const claims = source('src/insurance/claims.service.ts');
  assert(
    claims.includes("paymentMethod: 'SHA'"),
    'A settled claim writes a payment row with method SHA',
  );

  const billing = source('src/billing/billing.service.ts');
  const channelStart = billing.indexOf('getRevenueByPaymentChannel');

  assert(channelStart > 0, 'The revenue service exposes a channel split');

  const channelBody = billing.slice(channelStart, channelStart + 2_400);

  assert(
    channelBody.includes('schema.billingPayments.invoiceId') &&
      channelBody.includes('schema.billingInvoices.voidedAt'),
    'The split reads payments through their invoice and excludes voided ones',
  );
  assert(
    channelBody.includes('invoiceRangeConditions(range)'),
    'The split uses the same reporting window as the revenue totals',
  );
  assert(
    channelBody.includes('unmappedMethods'),
    'An unrecognised method is reported, never silently absorbed',
  );

  const app = source('src/app.ts');
  assert(
    app.includes('getRevenueByPaymentChannel(db, facilityId, range)'),
    'The revenue route asks for the split',
  );
  assert(
    app.includes('byChannel: channelSplit.channels'),
    'The revenue response carries the channel lines',
  );
  assert(
    app.includes('reconciled: channelDifferenceCents === 0'),
    'The response says whether the split reconciles to Collected',
  );

  const types = source('src/types/index.ts');
  assert(
    types.includes('byChannel?: RevenueChannelRow[]'),
    'The client knows the channel rows',
  );

  const reports = source('src/components/modules/ReportsModule.tsx');
  assert(
    reports.includes('Money In by Payment Channel'),
    'The revenue report renders the channel split',
  );
  assert(
    reports.includes('channelReconciliation.reconciled'),
    'The report states the reconciliation rather than assuming it',
  );
}

/* ============================================================
   2. EXPIRY COUNTDOWN
   ============================================================ */

function testCountdown(): void {
  console.log('2. The countdown runs to the end of the expiry day, local time');

  const deadline = expiryDeadline('2026-10-31');

  assert(deadline !== null, 'A real expiry date has a deadline');
  assertEqual(deadline?.getHours(), 23, 'The day itself is still usable (hours)');
  assertEqual(deadline?.getMinutes(), 59, 'The day itself is still usable (minutes)');
  assertEqual(deadline?.getDate(), 31, 'The deadline stays on the expiry date');

  /* Three whole days and eleven hours before the end of the 31st. */
  const threeDays = countdownTo('2026-10-31', new Date(2026, 9, 28, 12, 0, 0));

  assert(threeDays !== null, 'A future date counts down');
  assertEqual(threeDays?.expired, false, 'A future batch is not expired');
  assertEqual(threeDays?.days, 3, 'Whole days left are floored');
  assertEqual(threeDays?.hours, 11, 'The leftover hours are shown');

  /* The expiry day itself: zero days left, but not expired. */
  const lastDay = countdownTo('2026-10-31', new Date(2026, 9, 31, 9, 0, 0));

  assertEqual(lastDay?.expired, false, 'The expiry day is not expired');
  assertEqual(lastDay?.days, 0, 'The expiry day has no whole days left');

  /* The next day: expired. */
  const after = countdownTo('2026-10-31', new Date(2026, 10, 1, 0, 0, 1));

  assertEqual(after?.expired, true, 'The day after expiry is expired');
  assertEqual(after?.days, 0, 'An expired lot does not count negative days');

  /* A date the calendar does not have must not become a countdown. */
  assertEqual(
    expiryDeadline('2026-02-31'),
    null,
    'An impossible date is rejected, not rolled into March',
  );
  assertEqual(
    expiryDeadline('not-a-date'),
    null,
    'Free text is not a countdown',
  );

  /* The server's rule and the screen's rule must agree. */
  assertEqual(
    expiryStatus('2026-10-31', '2026-10-31'),
    'Expiring',
    'Server: a batch expiring today is still usable',
  );
  assertEqual(
    daysUntilExpiry('2026-10-31', '2026-10-31'),
    0,
    'Server: today is zero days to expiry',
  );

  /* Colour thresholds: ten days is the warning edge, three the danger edge. */
  assertEqual(expiryToneClass(0, true), 'text-rose-700', 'An expired lot is red');
  assertEqual(expiryToneClass(2, false), 'text-rose-600', 'Three days or fewer is red');
  assertEqual(expiryToneClass(3, false), 'text-rose-600', 'Three days is red');
  assertEqual(expiryToneClass(10, false), 'text-amber-700', 'Ten days is amber');
  assertEqual(expiryToneClass(30, false), 'text-slate-600', 'A distant expiry is quiet');

  const component = source('src/components/ExpiryCountdown.tsx');

  assert(
    component.includes('window.setInterval'),
    'The countdown ticks instead of freezing at render time',
  );
  assert(
    component.includes('60_000'),
    'It re-renders once a minute, not once a frame',
  );
}

/* ============================================================
   3. ADD STOCK ITEM — EXPIRY, AND THE OPENING BATCH
   ============================================================ */

function testAddStockItem(): void {
  console.log('3. The Add form records an expiry without inventing an item column');

  const inventory = source('src/components/modules/InventoryModule.tsx');

  assert(
    inventory.includes("batchNumber: ''") && inventory.includes("expiryDate: ''"),
    'The Add form holds a batch number and an expiry date',
  );
  assert(
    inventory.includes('Batch Number') && inventory.includes('Expiry Date'),
    'Both fields are labelled on the form',
  );
  assert(
    inventory.includes('currentStock: wantsBatch ? 0 : Number(newItem.currentStock)'),
    'A batch-backed item is created empty and filled by the batch',
  );
  assert(
    inventory.includes('await api.receiveBatch(created.id'),
    'The opening quantity is received into the first batch',
  );
  assert(
    inventory.includes('Enter both a batch number and an expiry date'),
    'Half a batch is refused rather than silently ignored',
  );
  assert(
    inventory.includes('That expiry date has already passed'),
    'An already-expired receipt is refused on the screen',
  );
  assert(
    inventory.includes('const { batchNumber: _batchNumber, expiryDate: _expiryDate, ...catalogueFields }'),
    'The batch fields are stripped before the catalogue insert',
  );
  assert(
    inventory.includes('The item was created, but its opening batch could not be received'),
    'A failed batch receive says the item exists and how to finish it',
  );

  assert(
    inventory.includes('<th className="px-4 py-2.5 font-medium">Expiry Countdown</th>'),
    'The stock list has a countdown column',
  );
  assert(
    inventory.includes('nearestExpiryByItem'),
    'The countdown is taken from the item\'s batches',
  );
  assert(
    inventory.includes('<ExpiryCountdown expiryDate={batch.expiryDate} short />'),
    'Each batch row carries the live countdown',
  );
  assert(
    inventory.includes('expiringWithin10'),
    'The batches tab names the lots inside the ten-day window',
  );

  /* Expiry stays a batch fact: no column was invented on the item. */
  const schema = source('src/db/schema.ts');
  const itemStart = schema.indexOf("export const inventoryItems = pgTable(");
  const itemEnd = schema.indexOf("export const inventoryBatches = pgTable(");
  const itemTable = schema.slice(itemStart, itemEnd);

  assert(
    itemStart > 0 && itemEnd > itemStart,
    'The inventory tables are where this test expects them',
  );
  assert(
    !itemTable.includes('expiryDate') && !itemTable.includes('expiry_date'),
    'No expiry column was added to inventory_items',
  );
  assert(
    schema.includes("expiryDate: text('expiry_date')"),
    'Expiry remains on inventory_batches',
  );
}

/* ============================================================
   4. THE OVERVIEW ALERT AT TEN DAYS
   ============================================================ */

function testOverviewAlert(): void {
  console.log('4. The overview raises the ten-day alert with the record behind it');

  const dashboard = source('src/components/modules/DashboardModule.tsx');

  assert(
    dashboard.includes('const EXPIRY_ALERT_DAYS = 10;'),
    'The horizon is a named constant, not a scattered literal',
  );
  assert(
    dashboard.includes('horizonDays: EXPIRY_ALERT_DAYS'),
    'The dashboard asks the server for the ten-day window',
  );
  assert(
    dashboard.includes('batch.daysToExpiry !== null') &&
      dashboard.includes('batch.daysToExpiry <= EXPIRY_ALERT_DAYS'),
    'Only lots at or inside ten days raise the alert',
  );
  assert(
    dashboard.includes("key: 'expiring-stock-10d'"),
    'The alert has its own key beside the thirty-day summary',
  );
  assert(
    dashboard.includes('expiring within ${EXPIRY_ALERT_DAYS} days'),
    'The alert states the ten-day horizon',
  );
  assert(
    dashboard.includes("tone: expiredBatchCount > 0 ? 'danger' : 'warning'"),
    'Anything already expired escalates the alert',
  );

  /* The record, not just the count. */
  assert(
    dashboard.includes('Stock about to expire') &&
      dashboard.includes('aria-label="Stock expiring soon"'),
    'The overview renders the expiring records',
  );
  assert(
    dashboard.includes('<th className="px-4 py-2 font-medium">Batch</th>'),
    'The record names the batch',
  );
  assert(
    dashboard.includes('batch.quantityRemaining') &&
      dashboard.includes('batch.expiryDate') &&
      dashboard.includes('batch.costPerUnit'),
    'The record carries quantity, expiry and cost',
  );
  assert(
    dashboard.includes('<ExpiryCountdown expiryDate={batch.expiryDate} short />'),
    'Each record carries the live countdown',
  );
  assert(
    dashboard.includes('{expiringRows.length > 0 && ('),
    'No panel is drawn when nothing is expiring',
  );
  assert(
    dashboard.includes('Expired lots are never dispensed'),
    'The panel states the rule it is reporting against',
  );
}

/* ============================================================
   5. ROLE PERMISSIONS — THE SAVE THAT DID NOT SAVE
   ============================================================ */

function testRoleSave(): void {
  console.log('5. A role save writes the scope the screen reads');

  const service = source('src/auth/staff-roles.service.ts');
  const routes = source('src/auth/staff-roles.routes.ts');
  const panel = source('src/components/modules/StaffRolesPanel.tsx');
  const editor = source('src/components/modules/FacilityRbacEditor.tsx');

  /* The read: an override, where present, is the effective set. */
  assert(
    service.includes('facilityRolePermissionOverridePermissions') &&
      service.includes('facilityRolePermissionOverrides'),
    'The task catalogue reads the facility override tables',
  );
  assert(
    service.includes('facilityOverride: {'),
    'The catalogue says whether an override is in force',
  );
  assert(
    service.includes('writeScope: override ? "FACILITY_OVERRIDE" : "TENANT_DEFAULT"'),
    'The catalogue says where a save will land',
  );
  assert(
    routes.includes('facilityId: scope.facilityId'),
    'The route supplies the acting facility, never a body value',
  );

  /* The write: the same scope, in one transaction. */
  assert(
    service.includes('delete(facilityRolePermissionOverridePermissions)'),
    'A save removes the revoked task from the override',
  );
  assert(
    service.includes('insert(facilityRolePermissionOverridePermissions)'),
    'A save adds the granted task to the override',
  );
  assert(
    service.includes('preservedOverrideIds'),
    'A non-delegable grant in the override is preserved, not stripped',
  );
  assert(
    service.includes('facilityOverrideUpdated'),
    'The response says whether the override moved',
  );
  assert(
    service.includes('Facility ${input.facilityId} override synchronized'),
    'The audit row names the facility whose override changed',
  );
  assert(
    service.includes('resource: "ROLE_PERMISSIONS"'),
    'The audit row still names the role permission change',
  );

  /* The screen: say the scope, and do not offer a save that changes nothing. */
  assert(
    panel.includes('This facility has its own permission set'),
    'The task modal says when a facility override is in force',
  );
  assert(
    panel.includes('No changes to save'),
    'The save button says when there is nothing to send',
  );
  assert(
    panel.includes('taskOriginal'),
    'The modal remembers the loaded set to detect a no-op save',
  );
  assert(
    panel.includes('facilityOverrideUpdated') || panel.includes('writeScope'),
    'The panel reports the scope the server wrote',
  );

  /* The platform editor: a successful save keeps its receipt. */
  assert(
    editor.includes('preserveNotice'),
    'Reloading after a save can keep the notice',
  );
  assert(
    editor.includes('if (!options?.preserveNotice)'),
    'The notice is cleared only on an ordinary load',
  );
  assert(
    editor.includes('await loadRoles({ preserveNotice: true })'),
    'A save reloads the authoritative state without erasing its message',
  );
  assert(
    editor.includes('draftUnchanged'),
    'An override that already matches the draft is not offered as a save',
  );
  assert(
    editor.includes('No changes to save'),
    'The platform save button says when there is nothing to send',
  );

  /*
   * And the layering that caused the complaint is still true: an
   * override outranks the tenant rows. The fix is to write both, not to
   * pretend the precedence does not exist.
   */
  const authorization = source('src/auth/authorization.service.ts');

  assert(
    authorization.includes('if (overrideId !== null)'),
    'An override still replaces the tenant permissions at read time',
  );
}

/* ============================================================
   6. THE README'S CODE TABLE
   ============================================================ */

function testReadmeCodes(): void {
  console.log('6. The README says which codes a facility should create');

  const readme = source('README.md');

  assert(
    readme.includes('Codes to use in a facility, for a billing structure that works on the first try'),
    'The README carries the billing-code guidance',
  );

  for (const code of [
    'OPD-001',
    'LAB-CBC',
    'RAD-001',
    'PROC-001',
    'ADM-001',
    'BED-GEN',
    'MAT-001',
    'DRUG-<NAME>',
  ]) {
    assert(readme.includes(code), `The code table names ${code}`);
  }

  for (const family of [
    'CONSULTATION',
    'LABORATORY',
    'RADIOLOGY',
    'PROCEDURE',
    'ADMISSION',
    'BED_DAY',
    'DELIVERY',
    'PHARMACY',
  ]) {
    assert(readme.includes(`\`${family}`), `The link column names ${family}`);
  }

  assert(
    readme.includes('Nothing here is seeded.'),
    'The README says no price was seeded',
  );
  assert(
    readme.includes('File the tariff under the right module.'),
    'The README says the department must match the charge',
  );
  assert(
    readme.includes('A plain `BED_DAY` link is skipped for'),
    'The README warns that a general bed link does not price a special bed',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('ROUND FIVE TESTS');
  console.log('==============================================');
  console.log('');

  testPaymentChannels();
  testCountdown();
  testAddStockItem();
  testOverviewAlert();
  testRoleSave();
  testReadmeCodes();

  console.log('');
  console.log('==============================================');
  console.log(`ROUND FIVE TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('ROUND FIVE TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
