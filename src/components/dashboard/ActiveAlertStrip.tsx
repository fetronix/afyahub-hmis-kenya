import React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { useInbox } from '../../context/InboxContext.tsx';
import { useHmis } from '../../context/HmisContext.tsx';
import type { AlertGroup, NotificationDestination } from '../../notifications/inbox.types.ts';

function groupLabel(group: AlertGroup, count: number): string {
  const one = count === 1;
  switch (group) {
    case 'expired':
      return one ? 'expired batch' : 'expired batches';
    case 'expiry7':
      return one ? 'batch expires within 7 days' : 'batches expire within 7 days';
    case 'expiry30':
      return one ? 'batch expires within 30 days' : 'batches expire within 30 days';
    case 'stockout':
      return one ? 'stock-out' : 'stock-outs';
    case 'lowStock':
      return one ? 'low stock item' : 'low stock items';
    case 'inventoryReview':
      return one ? 'inventory record needs review' : 'inventory records need review';
    case 'criticalLab':
      return one
        ? 'critical lab flag awaiting verification'
        : 'critical lab flags awaiting verification';
  }
}
export const ActiveAlertStrip: React.FC = () => {
  const inbox = useInbox();
  const { setActiveModule, authenticatedUser, currentFacility } = useHmis();
  const permitted = (destination: NotificationDestination) => {
    const permissions = {
      inventory: 'inventory.read',
      laboratory: 'laboratory.read',
      registration: 'patients.read',
      reception: 'appointments.read',
      inpatient: 'inpatient.read',
      theatre: 'theatre.read',
      finance: 'billing.read',
    };
    return (
      !authenticatedUser?.isSuperAdmin &&
      !authenticatedUser?.roles?.includes('SUPER_ADMIN') &&
      authenticatedUser?.permissions?.includes(permissions[destination]) &&
      currentFacility?.enabledModules?.includes(destination) &&
      !currentFacility?.hiddenModules?.includes(destination)
    );
  };
  const groups = inbox.data?.alertGroups ?? [];
  return (
    <section
      aria-label="Active operational alerts"
      className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e3eaf2] bg-white px-4 py-3"
    >
      <span className="mr-1 flex items-center gap-1.5 text-[11px] font-bold text-[#243955]">
        <AlertCircle className="h-4 w-4 text-amber-600" /> Active alerts
      </span>
      {!inbox.available ? (
        <span role="status" className="text-[11px] text-slate-500">
          Alert sources are unavailable for this account or facility.
        </span>
      ) : inbox.error ? (
        <span role="status" className="text-[11px] text-amber-800">
          Alerts unavailable.{' '}
          <button type="button" onClick={inbox.refresh} className="font-semibold underline">
            Retry <RefreshCw className="inline h-3 w-3" />
          </button>
        </span>
      ) : !inbox.data ? (
        <span className="text-[11px] text-slate-500">Checking available sources…</span>
      ) : groups.length ? (
        <>
          {groups.slice(0, 3).map((group) => (
            <span
              key={group.group}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${group.severity === 'CRITICAL' ? 'bg-rose-50 text-rose-800' : 'bg-orange-50 text-orange-800'}`}
            >
              <span>
                {group.count} {groupLabel(group.group, group.count)}
              </span>
              {permitted(group.destination) && (
                <button
                  type="button"
                  onClick={() => setActiveModule(group.destination)}
                  className="ml-1 whitespace-nowrap font-bold underline"
                >
                  View
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            onClick={() => inbox.setOpen(true)}
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:underline"
          >
            {groups.length > 3 ? `+${groups.length - 3} more · ` : ''}View alerts{' '}
            <ArrowRight className="h-3 w-3" />
          </button>
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-[11px] text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {inbox.data.availableSources.some(
            (source) => source === 'Inventory stock and batches' || source === 'Laboratory',
          )
            ? 'No active alerts in the accessible inventory or laboratory sources.'
            : 'Inventory and laboratory alert sources are unavailable for this account.'}
        </span>
      )}
    </section>
  );
};
