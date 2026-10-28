import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAYMENT_CHANNELS, PAYMENT_CHANNEL_LABELS, paymentChannel } from '../billing/settlement.ts';
import { countdownTo, expiryDeadline, expiryToneClass } from '../components/ExpiryCountdown.tsx';
import { daysUntilExpiry, expiryStatus } from '../inventory/inventory-contracts.ts';
import { schemaSource, appSource, staffRolesServiceSource } from './support/schema-source.ts';
import { containsCode } from './support/source-text.ts';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Round five — expiry, the revenue split, and the role save that vanished', () => {
  it('1. PAYMENT CHANNELS — SHA, online mobile money, cash', async () => {
    /* Order matters: the screen prints them in this order. */
    expect(
      JSON.stringify(PAYMENT_CHANNELS),
      'The split covers SHA, mobile money, cash, card and an honest other',
    ).toBe(JSON.stringify(['SHA', 'MOBILE_MONEY', 'CASH', 'CARD', 'OTHER']));

    /* SHA is a payer. A claim settles into a payment row with method SHA. */
    expect(JSON.stringify(paymentChannel('SHA')), 'SHA is its own channel').toBe(
      JSON.stringify('SHA'),
    );
    expect(JSON.stringify(paymentChannel('sha')), 'SHA is matched case-insensitively').toBe(
      JSON.stringify('SHA'),
    );
    expect(
      JSON.stringify(paymentChannel('SHA Claim')),
      'A spaced SHA claim label still lands in SHA',
    ).toBe(JSON.stringify('SHA'));

    /* Online mobile money, however the till spelled it. */
    expect(JSON.stringify(paymentChannel('M-Pesa')), 'M-Pesa is mobile money').toBe(
      JSON.stringify('MOBILE_MONEY'),
    );
    expect(JSON.stringify(paymentChannel('MPESA')), 'MPESA is mobile money').toBe(
      JSON.stringify('MOBILE_MONEY'),
    );
    expect(JSON.stringify(paymentChannel('m pesa')), 'm pesa is mobile money').toBe(
      JSON.stringify('MOBILE_MONEY'),
    );
    expect(JSON.stringify(paymentChannel('Airtel Money')), 'Airtel Money is mobile money').toBe(
      JSON.stringify('MOBILE_MONEY'),
    );

    expect(JSON.stringify(paymentChannel('Cash')), 'Cash is its own channel').toBe(
      JSON.stringify('CASH'),
    );
    expect(JSON.stringify(paymentChannel('CARD')), 'Card is not folded into cash').toBe(
      JSON.stringify('CARD'),
    );

    /*
     * A private insurer named "Insurance" is not SHA. Guessing it into the
     * SHA line would overstate public claims and understate the payer.
     */
    expect(
      JSON.stringify(paymentChannel('Insurance')),
      'An unrecognised payer is not guessed into SHA',
    ).toBe(JSON.stringify('OTHER'));
    expect(JSON.stringify(paymentChannel('')), 'An empty method is other').toBe(
      JSON.stringify('OTHER'),
    );
    expect(JSON.stringify(paymentChannel(null)), 'A missing method is other').toBe(
      JSON.stringify('OTHER'),
    );

    expect(
      JSON.stringify(PAYMENT_CHANNEL_LABELS.MOBILE_MONEY),
      'The mobile channel is labelled as the online rail',
    ).toBe(JSON.stringify('Online mobile money'));

    /* Claim settlement links an existing payer receipt; it must not create one. */
    const claims = source('src/insurance/claims.service.ts');
    expect(
      claims.includes('matchRecordedPayerPayment'),
      'Settlement requires an existing receipt',
    ).toBe(true);
    expect(claims.includes('recordPayment('), 'Claim approval does not create a payment').toBe(
      false,
    );

    const billing = source('src/billing/billing.service.ts');
    const channelStart = billing.indexOf('getRevenueByPaymentChannel');

    expect(channelStart > 0, 'The revenue service exposes a channel split').toBe(true);

    const channelBody = billing.slice(channelStart, channelStart + 2_400);

    expect(
      channelBody.includes('schema.billingPayments.invoiceId') &&
        channelBody.includes('schema.billingInvoices.voidedAt'),
      'The split reads payments through their invoice and excludes voided ones',
    ).toBe(true);
    expect(
      channelBody.includes('invoiceRangeConditions(range)'),
      'The split uses the same reporting window as the revenue totals',
    ).toBe(true);
    expect(
      channelBody.includes('unmappedMethods'),
      'An unrecognised method is reported, never silently absorbed',
    ).toBe(true);

    const app = appSource();
    expect(
      app.includes('getRevenueByPaymentChannel(db, facilityId, range)'),
      'The revenue route asks for the split',
    ).toBe(true);
    expect(
      app.includes('byChannel: channelSplit.channels'),
      'The revenue response carries the channel lines',
    ).toBe(true);
    expect(
      app.includes('reconciled: channelDifferenceCents === 0'),
      'The response says whether the split reconciles to Collected',
    ).toBe(true);

    const types = source('src/types/index.ts');
    expect(
      types.includes('byChannel?: RevenueChannelRow[]'),
      'The client knows the channel rows',
    ).toBe(true);

    const reports = source('src/components/modules/ReportsModule.tsx');
    expect(
      reports.includes('Money In by Payment Channel'),
      'The revenue report renders the channel split',
    ).toBe(true);
    expect(
      reports.includes('channelReconciliation.reconciled'),
      'The report states the reconciliation rather than assuming it',
    ).toBe(true);
  });

  it('2. EXPIRY COUNTDOWN', async () => {
    const deadline = expiryDeadline('2026-10-31');

    expect(deadline !== null, 'A real expiry date has a deadline').toBe(true);
    expect(JSON.stringify(deadline?.getHours()), 'The day itself is still usable (hours)').toBe(
      JSON.stringify(23),
    );
    expect(JSON.stringify(deadline?.getMinutes()), 'The day itself is still usable (minutes)').toBe(
      JSON.stringify(59),
    );
    expect(JSON.stringify(deadline?.getDate()), 'The deadline stays on the expiry date').toBe(
      JSON.stringify(31),
    );

    /* Three whole days and eleven hours before the end of the 31st. */
    const threeDays = countdownTo('2026-10-31', new Date(2026, 9, 28, 12, 0, 0));

    expect(threeDays !== null, 'A future date counts down').toBe(true);
    expect(JSON.stringify(threeDays?.expired), 'A future batch is not expired').toBe(
      JSON.stringify(false),
    );
    expect(JSON.stringify(threeDays?.days), 'Whole days left are floored').toBe(JSON.stringify(3));
    expect(JSON.stringify(threeDays?.hours), 'The leftover hours are shown').toBe(
      JSON.stringify(11),
    );

    /* The expiry day itself: zero days left, but not expired. */
    const lastDay = countdownTo('2026-10-31', new Date(2026, 9, 31, 9, 0, 0));

    expect(JSON.stringify(lastDay?.expired), 'The expiry day is not expired').toBe(
      JSON.stringify(false),
    );
    expect(JSON.stringify(lastDay?.days), 'The expiry day has no whole days left').toBe(
      JSON.stringify(0),
    );

    /* The next day: expired. */
    const after = countdownTo('2026-10-31', new Date(2026, 10, 1, 0, 0, 1));

    expect(JSON.stringify(after?.expired), 'The day after expiry is expired').toBe(
      JSON.stringify(true),
    );
    expect(JSON.stringify(after?.days), 'An expired lot does not count negative days').toBe(
      JSON.stringify(0),
    );

    /* A date the calendar does not have must not become a countdown. */
    expect(
      JSON.stringify(expiryDeadline('2026-02-31')),
      'An impossible date is rejected, not rolled into March',
    ).toBe(JSON.stringify(null));
    expect(JSON.stringify(expiryDeadline('not-a-date')), 'Free text is not a countdown').toBe(
      JSON.stringify(null),
    );

    /* The server's rule and the screen's rule must agree. */
    expect(
      JSON.stringify(expiryStatus('2026-10-31', '2026-10-31')),
      'Server: a batch expiring today is still usable',
    ).toBe(JSON.stringify('Expiring'));
    expect(
      JSON.stringify(daysUntilExpiry('2026-10-31', '2026-10-31')),
      'Server: today is zero days to expiry',
    ).toBe(JSON.stringify(0));

    /* Colour thresholds: ten days is the warning edge, three the danger edge. */
    expect(JSON.stringify(expiryToneClass(0, true)), 'An expired lot is red').toBe(
      JSON.stringify('text-rose-700'),
    );
    expect(JSON.stringify(expiryToneClass(2, false)), 'Three days or fewer is red').toBe(
      JSON.stringify('text-rose-600'),
    );
    expect(JSON.stringify(expiryToneClass(3, false)), 'Three days is red').toBe(
      JSON.stringify('text-rose-600'),
    );
    expect(JSON.stringify(expiryToneClass(10, false)), 'Ten days is amber').toBe(
      JSON.stringify('text-amber-700'),
    );
    expect(JSON.stringify(expiryToneClass(30, false)), 'A distant expiry is quiet').toBe(
      JSON.stringify('text-slate-600'),
    );

    const component = source('src/components/ExpiryCountdown.tsx');

    expect(
      component.includes('window.setInterval'),
      'The countdown ticks instead of freezing at render time',
    ).toBe(true);
    expect(component.includes('60_000'), 'It re-renders once a minute, not once a frame').toBe(
      true,
    );
  });

  it('3. ADD STOCK ITEM — EXPIRY, AND THE OPENING BATCH', async () => {
    const inventory = source('src/components/modules/InventoryModule.tsx');

    expect(
      inventory.includes("batchNumber: ''") && inventory.includes("expiryDate: ''"),
      'The Add form holds a batch number and an expiry date',
    ).toBe(true);
    expect(
      inventory.includes('Batch Number') && inventory.includes('Expiry Date'),
      'Both fields are labelled on the form',
    ).toBe(true);
    expect(
      inventory.includes('currentStock: wantsBatch ? 0 : Number(newItem.currentStock)'),
      'A batch-backed item is created empty and filled by the batch',
    ).toBe(true);
    expect(
      inventory.includes('await api.receiveBatch(created.id'),
      'The opening quantity is received into the first batch',
    ).toBe(true);
    expect(
      inventory.includes('Enter both a batch number and an expiry date'),
      'Half a batch is refused rather than silently ignored',
    ).toBe(true);
    expect(
      inventory.includes('That expiry date has already passed'),
      'An already-expired receipt is refused on the screen',
    ).toBe(true);
    expect(
      inventory.includes(
        'const { batchNumber: _batchNumber, expiryDate: _expiryDate, ...catalogueFields }',
      ),
      'The batch fields are stripped before the catalogue insert',
    ).toBe(true);
    expect(
      inventory.includes('The item was created, but its opening batch could not be received'),
      'A failed batch receive says the item exists and how to finish it',
    ).toBe(true);

    expect(
      inventory.includes('<th className="px-4 py-2.5 font-medium">Expiry Countdown</th>'),
      'The stock list has a countdown column',
    ).toBe(true);
    expect(
      inventory.includes('nearestExpiryByItem'),
      "The countdown is taken from the item's batches",
    ).toBe(true);
    expect(
      inventory.includes('<ExpiryCountdown expiryDate={batch.expiryDate} short />'),
      'Each batch row carries the live countdown',
    ).toBe(true);
    expect(
      inventory.includes('expiringWithin10'),
      'The batches tab names the lots inside the ten-day window',
    ).toBe(true);

    /* Expiry stays a batch fact: no column was invented on the item. */
    const schema = schemaSource();
    const itemStart = schema.indexOf('export const inventoryItems = pgTable(');
    const itemEnd = schema.indexOf('export const inventoryBatches = pgTable(');
    const itemTable = schema.slice(itemStart, itemEnd);

    expect(
      itemStart > 0 && itemEnd > itemStart,
      'The inventory tables are where this test expects them',
    ).toBe(true);
    expect(
      !itemTable.includes('expiryDate') && !itemTable.includes('expiry_date'),
      'No expiry column was added to inventory_items',
    ).toBe(true);
    expect(
      schema.includes("expiryDate: text('expiry_date')"),
      'Expiry remains on inventory_batches',
    ).toBe(true);
  });

  it('4. THE OVERVIEW ALERT AT TEN DAYS', async () => {
    const dashboard = source('src/components/modules/DashboardModule.tsx');

    expect(
      dashboard.includes('const EXPIRY_ALERT_DAYS = 10;'),
      'The horizon is a named constant, not a scattered literal',
    ).toBe(true);
    expect(
      dashboard.includes('horizonDays: EXPIRY_ALERT_DAYS'),
      'The dashboard asks the server for the ten-day window',
    ).toBe(true);
    expect(
      dashboard.includes('batch.daysToExpiry !== null') &&
        dashboard.includes('batch.daysToExpiry <= EXPIRY_ALERT_DAYS'),
      'Only lots at or inside ten days raise the alert',
    ).toBe(true);
    expect(
      dashboard.includes("key: 'expiring-stock-10d'"),
      'The alert has its own key beside the thirty-day summary',
    ).toBe(true);
    expect(
      dashboard.includes('expiring within ${EXPIRY_ALERT_DAYS} days'),
      'The alert states the ten-day horizon',
    ).toBe(true);
    expect(
      dashboard.includes("tone: expiredBatchCount > 0 ? 'danger' : 'warning'"),
      'Anything already expired escalates the alert',
    ).toBe(true);

    /* The record, not just the count. */
    expect(
      dashboard.includes('Stock about to expire') &&
        dashboard.includes('aria-label="Stock expiring soon"'),
      'The overview renders the expiring records',
    ).toBe(true);
    expect(
      dashboard.includes('<th className="px-4 py-2 font-medium">Batch</th>'),
      'The record names the batch',
    ).toBe(true);
    expect(
      dashboard.includes('batch.quantityRemaining') &&
        dashboard.includes('batch.expiryDate') &&
        dashboard.includes('batch.costPerUnit'),
      'The record carries quantity, expiry and cost',
    ).toBe(true);
    expect(
      dashboard.includes('<ExpiryCountdown expiryDate={batch.expiryDate} short />'),
      'Each record carries the live countdown',
    ).toBe(true);
    expect(
      dashboard.includes('{expiringRows.length > 0 && ('),
      'No panel is drawn when nothing is expiring',
    ).toBe(true);
    expect(
      dashboard.includes('Expired lots are never dispensed'),
      'The panel states the rule it is reporting against',
    ).toBe(true);
  });

  it('5. ROLE PERMISSIONS — THE SAVE THAT DID NOT SAVE', async () => {
    const service = staffRolesServiceSource();
    const routes = source('src/auth/staff-roles.routes.ts');
    const panel = source('src/components/modules/StaffRolesPanel.tsx');
    const editor = source('src/components/modules/FacilityRbacEditor.tsx');

    /* The read: an override, where present, is the effective set. */
    expect(
      service.includes('facilityRolePermissionOverridePermissions') &&
        service.includes('facilityRolePermissionOverrides'),
      'The task catalogue reads the facility override tables',
    ).toBe(true);
    expect(
      service.includes('facilityOverride: {'),
      'The catalogue says whether an override is in force',
    ).toBe(true);
    expect(
      containsCode(service, 'writeScope: override ? "FACILITY_OVERRIDE" : "TENANT_DEFAULT"'),
      'The catalogue says where a save will land',
    ).toBe(true);
    expect(
      routes.includes('facilityId: scope.facilityId'),
      'The route supplies the acting facility, never a body value',
    ).toBe(true);

    /* The write: the same scope, in one transaction. */
    expect(
      service.includes('delete(facilityRolePermissionOverridePermissions)'),
      'A save removes the revoked task from the override',
    ).toBe(true);
    expect(
      service.includes('insert(facilityRolePermissionOverridePermissions)'),
      'A save adds the granted task to the override',
    ).toBe(true);
    expect(
      service.includes('preservedOverrideIds'),
      'A non-delegable grant in the override is preserved, not stripped',
    ).toBe(true);
    expect(
      service.includes('facilityOverrideUpdated'),
      'The response says whether the override moved',
    ).toBe(true);
    expect(
      service.includes('Facility ${input.facilityId} override synchronized'),
      'The audit row names the facility whose override changed',
    ).toBe(true);
    expect(
      containsCode(service, 'resource: "ROLE_PERMISSIONS"'),
      'The audit row still names the role permission change',
    ).toBe(true);

    /* The screen: say the scope, and do not offer a save that changes nothing. */
    expect(
      panel.includes('This facility has its own permission set'),
      'The task modal says when a facility override is in force',
    ).toBe(true);
    expect(
      panel.includes('No changes to save'),
      'The save button says when there is nothing to send',
    ).toBe(true);
    expect(
      panel.includes('taskOriginal'),
      'The modal remembers the loaded set to detect a no-op save',
    ).toBe(true);
    expect(
      panel.includes('facilityOverrideUpdated') || panel.includes('writeScope'),
      'The panel reports the scope the server wrote',
    ).toBe(true);

    /* The platform editor: a successful save keeps its receipt. */
    expect(editor.includes('preserveNotice'), 'Reloading after a save can keep the notice').toBe(
      true,
    );
    expect(
      editor.includes('if (!options?.preserveNotice)'),
      'The notice is cleared only on an ordinary load',
    ).toBe(true);
    expect(
      editor.includes('await loadRoles({ preserveNotice: true })'),
      'A save reloads the authoritative state without erasing its message',
    ).toBe(true);
    expect(
      editor.includes('draftUnchanged'),
      'An override that already matches the draft is not offered as a save',
    ).toBe(true);
    expect(
      editor.includes('No changes to save'),
      'The platform save button says when there is nothing to send',
    ).toBe(true);

    /*
     * And the layering that caused the complaint is still true: an
     * override outranks the tenant rows. The fix is to write both, not to
     * pretend the precedence does not exist.
     */
    const authorization = source('src/auth/authorization.service.ts');

    expect(
      authorization.includes('if (overrideId !== null)'),
      'An override still replaces the tenant permissions at read time',
    ).toBe(true);
  });

  it("6. THE README'S CODE TABLE", async () => {
    const readme = source('README.md');

    expect(
      readme.includes(
        'Codes to use in a facility, for a billing structure that works on the first try',
      ),
      'The README carries the billing-code guidance',
    ).toBe(true);

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
      expect(readme.includes(code), `The code table names ${code}`).toBe(true);
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
      expect(readme.includes(`\`${family}`), `The link column names ${family}`).toBe(true);
    }

    expect(readme.includes('Nothing here is seeded.'), 'The README says no price was seeded').toBe(
      true,
    );
    expect(
      readme.includes('File the tariff under the right module.'),
      'The README says the department must match the charge',
    ).toBe(true);
    expect(
      readme.includes('A plain `BED_DAY` link is skipped for'),
      'The README warns that a general bed link does not price a special bed',
    ).toBe(true);
  });
});
