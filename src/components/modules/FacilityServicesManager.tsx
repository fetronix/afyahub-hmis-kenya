import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { ApiError } from '../../api/clients/http.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import type { FacilityService, ServiceTariff } from '../../types/index.ts';
import type { FacilityServiceExpectedState } from '../../api/clients/billing.client.ts';
import { FacilityServicesTable, FacilityTariffsTable } from './FacilityPricingTables.tsx';

const departments = [
  ['opd', 'OPD'],
  ['laboratory', 'Laboratory'],
  ['radiology', 'Radiology'],
  ['pharmacy', 'Pharmacy'],
  ['inpatient', 'Inpatient'],
  ['maternity', 'Maternity'],
  ['theatre', 'Theatre'],
  ['specialty', 'Specialty'],
  ['registration', 'Registration'],
  ['reception', 'Reception'],
  ['insurance', 'Insurance'],
  ['finance', 'General / Finance'],
] as const;
const categories = [
  'CONSULTATION',
  'LABORATORY',
  'RADIOLOGY',
  'PHARMACY',
  'PROCEDURE',
  'ADMISSION',
  'BED_DAY',
  'DELIVERY',
  'OTHER',
];
const blankService = {
  code: '',
  name: '',
  description: '',
  department: '',
  category: '',
  unit: '',
  initialPrice: '',
  initialTariffCode: '',
  isActive: true,
  autoBill: true,
};
const blankTariff = {
  serviceId: '',
  code: '',
  description: '',
  department: '',
  unit: '',
  fee: '',
  effectiveFrom: '',
  effectiveTo: '',
  isActive: true,
  autoBill: true,
};

export const FacilityServicesManager: React.FC<{
  facilityId: number;
  enabledModules: string[];
  canManage: boolean;
}> = ({ facilityId, enabledModules, canManage }) => {
  const { triggerRefresh } = useHmis();
  const defaultService = () => ({
    ...blankService,
    department: enabledModules.includes('opd')
      ? 'opd'
      : (departments.find(([id]) => enabledModules.includes(id))?.[0] ?? ''),
  });
  const [services, setServices] = useState<FacilityService[]>([]);
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceEdit, setServiceEdit] = useState<number | null>(null);
  const [serviceExpected, setServiceExpected] = useState<FacilityServiceExpectedState | null>(null);
  const [service, setService] = useState(blankService);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [tariffEdit, setTariffEdit] = useState<number | null>(null);
  const [tariffRevision, setTariffRevision] = useState<number | null>(null);
  const [tariff, setTariff] = useState(blankTariff);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const [serviceRows, tariffRows] = await Promise.all([
        api.getFacilityServices(facilityId),
        api.getFacilityTariffs(facilityId),
      ]);
      if (!Array.isArray(serviceRows) || !Array.isArray(tariffRows))
        throw new Error('Invalid facility service response.');
      if (current === generation.current) {
        setServices(serviceRows);
        setTariffs(tariffRows);
        return true;
      }
      return false;
    } catch (err) {
      if (current === generation.current) {
        setServices([]);
        setTariffs([]);
        setError(err instanceof Error ? err.message : 'Unable to load facility services.');
      }
      return false;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [facilityId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    if (busy || !canManage || needsVerification) return;
    setBusy(true);
    setError('');
    setNotice('');
    let accepted = false;
    try {
      await action();
      accepted = true;
      const refreshed = await load();
      triggerRefresh();
      if (successMessage)
        setNotice(
          refreshed
            ? successMessage
            : `${successMessage} The list could not be refreshed. Reload before making another change.`,
        );
    } catch (err) {
      // A lost response, proxy error, or unreadable success response does not
      // prove that the transaction failed. Do not let a user retry blindly.
      const uncertain =
        accepted || !(err instanceof ApiError) || err.status < 400 || err.status >= 500;
      const message = err instanceof Error ? err.message : 'The change could not be confirmed.';
      setNeedsVerification(uncertain);
      setError(
        uncertain
          ? `${message} The change may have been saved. Reload the lists and verify before retrying.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
  function editService(row: FacilityService) {
    setServiceEdit(row.id);
    setServiceExpected({
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      autoBill: row.autoBill,
    });
    setTariffOpen(false);
    setService({
      code: row.code,
      name: row.name,
      description: row.description,
      department: row.department,
      category: row.category,
      unit: row.unit,
      initialPrice: '',
      initialTariffCode: '',
      isActive: row.isActive,
      autoBill: row.autoBill,
    });
    setServiceOpen(true);
  }
  function editTariff(row: ServiceTariff) {
    setTariffEdit(row.id);
    setTariffRevision(row.revision ?? null);
    setServiceOpen(false);
    setTariff({
      serviceId: row.facilityServiceId ? String(row.facilityServiceId) : '',
      code: row.code,
      description: row.description,
      department: row.department,
      unit: row.unit,
      fee: String(row.fee),
      effectiveFrom: row.effectiveFrom ?? '',
      effectiveTo: row.effectiveTo ?? '',
      isActive: row.isActive,
      autoBill: row.autoBill,
    });
    setTariffOpen(true);
  }
  async function saveService(event: React.FormEvent) {
    event.preventDefault();
    const expected = serviceExpected;
    if (serviceEdit && !expected) {
      setNotice('');
      setError('Reload the service before saving.');
      return;
    }
    await run(
      async () => {
        const common = {
          facilityId,
          code: service.code,
          name: service.name,
          description: service.description,
          department: service.department,
          category: service.category,
          unit: service.unit,
          isActive: service.isActive,
          autoBill: service.autoBill,
        };
        if (serviceEdit && expected) {
          await api.updateFacilityService(serviceEdit, {
            ...common,
            expectedState: expected,
          });
        } else
          await api.createFacilityService({
            ...common,
            initialPrice: service.initialPrice,
            ...(service.initialTariffCode.trim()
              ? { initialTariffCode: service.initialTariffCode }
              : {}),
          });
        setServiceOpen(false);
        setService(blankService);
        setServiceEdit(null);
        setServiceExpected(null);
      },
      serviceEdit ? 'Service changes saved.' : 'Service and initial tariff saved.',
    );
  }
  async function saveTariff(event: React.FormEvent) {
    event.preventDefault();
    const revision = tariffRevision;
    if (tariffEdit && !revision) {
      setNotice('');
      setError('Reload the tariff before saving.');
      return;
    }
    await run(
      async () => {
        const input = {
          facilityId,
          serviceId: Number(tariff.serviceId),
          code: tariff.code,
          description: tariff.description,
          department: tariff.department,
          unit: tariff.unit,
          fee: tariff.fee,
          effectiveFrom: tariff.effectiveFrom || null,
          effectiveTo: tariff.effectiveTo || null,
          isActive: tariff.isActive,
          autoBill: tariff.autoBill,
        };
        if (tariffEdit && revision) {
          await api.updateFacilityTariff(tariffEdit, {
            ...input,
            expectedRevision: revision,
          });
        } else await api.createFacilityTariff(input);
        setTariffOpen(false);
        setTariff(blankTariff);
        setTariffEdit(null);
        setTariffRevision(null);
      },
      tariffEdit ? 'Tariff changes saved.' : 'Tariff saved.',
    );
  }
  // Master-only rows remain in PostgreSQL for history but are not a
  // facility service price list. Do not hide a tariff already attached to
  // a direct service: it may still be used by billing and must remain visible.
  const visibleTariffs = tariffs.filter(
    (row) => row.masterServiceId == null || row.facilityServiceId != null,
  );
  const fields =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-teal-600 focus:outline-2 focus:outline-teal-100 disabled:bg-slate-100 disabled:text-slate-500';
  const button =
    'rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <section className="space-y-4 text-sm" aria-label="Facility services and tariffs">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Facility Services &amp; Tariffs</h2>
          <p className="text-slate-600">
            Services and prices belong to facility #{facilityId}. Zero means unconfigured, not free.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={!canManage || busy || loading || Boolean(error) || serviceOpen || tariffOpen}
            onClick={() => {
              setService(defaultService());
              setServiceEdit(null);
              setServiceExpected(null);
              setTariffOpen(false);
              setServiceOpen(true);
            }}
          >
            Add service
          </button>
          <button
            className={button}
            disabled={
              !canManage ||
              busy ||
              loading ||
              Boolean(error) ||
              serviceOpen ||
              tariffOpen ||
              !services.length
            }
            onClick={() => {
              setTariff(blankTariff);
              setTariffEdit(null);
              setTariffRevision(null);
              setServiceOpen(false);
              setTariffOpen(true);
            }}
          >
            Add tariff
          </button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-800"
        >
          <p>{error}</p>
          <button
            type="button"
            className="rounded border border-rose-300 bg-white px-3 py-1.5 font-semibold disabled:opacity-50"
            disabled={busy || loading}
            onClick={() => {
              if (
                (serviceOpen || tariffOpen) &&
                !window.confirm('Reload the lists and discard the unsaved form?')
              )
                return;
              setServiceOpen(false);
              setTariffOpen(false);
              setServiceEdit(null);
              setTariffEdit(null);
              setServiceExpected(null);
              setTariffRevision(null);
              void load().then((refreshed) => {
                if (refreshed) setNeedsVerification(false);
              });
            }}
          >
            Reload lists
          </button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loading && <p>Loading facility services and tariffs…</p>}
      {(serviceOpen || tariffOpen) && (
        <p className="text-xs text-slate-600">
          Save or cancel the open form before managing another row.
        </p>
      )}
      {serviceOpen && (
        <form
          onSubmit={saveService}
          className="grid gap-4 rounded-xl border border-teal-200 bg-teal-50/30 p-4 shadow-sm sm:grid-cols-2 sm:p-5"
        >
          <h3 className="font-bold sm:col-span-2">
            {serviceEdit ? 'Edit service' : 'Add facility service'}
          </h3>
          <label>
            Service name
            <input
              required
              maxLength={200}
              className={fields}
              value={service.name}
              onChange={(e) => setService({ ...service, name: e.target.value })}
            />
          </label>
          <label>
            Service code
            <input
              required
              maxLength={50}
              className={fields}
              disabled={serviceEdit !== null}
              value={service.code}
              onChange={(e) => setService({ ...service, code: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            Description
            <input
              required
              maxLength={500}
              className={fields}
              value={service.description}
              onChange={(e) => setService({ ...service, description: e.target.value })}
            />
          </label>
          <label>
            Department
            <select
              required
              className={fields}
              disabled={serviceEdit !== null}
              value={service.department}
              onChange={(e) =>
                setService({ ...service, department: e.target.value, category: '', unit: '' })
              }
            >
              <option value="">Select an enabled department</option>
              {departments
                .filter(
                  ([id]) =>
                    enabledModules.includes(id) ||
                    (serviceEdit !== null && id === service.department),
                )
                .map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Service category
            <select
              required
              className={fields}
              disabled={serviceEdit !== null}
              value={service.category}
              onChange={(e) => setService({ ...service, category: e.target.value })}
            >
              <option value="">Select a service category</option>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Billing unit
            <input
              required
              maxLength={50}
              className={fields}
              disabled={serviceEdit !== null}
              value={service.unit}
              onChange={(e) => setService({ ...service, unit: e.target.value })}
            />
          </label>
          <p className="text-xs text-slate-600 sm:col-span-2">
            Choose the correct category and billing unit. The service code, department, category and
            unit cannot be changed after saving.
          </p>
          {!serviceEdit && (
            <>
              <label>
                Initial price (KES)
                <input
                  required
                  inputMode="decimal"
                  className={fields}
                  value={service.initialPrice}
                  onChange={(e) => setService({ ...service, initialPrice: e.target.value })}
                />
              </label>
              <label>
                Initial tariff code{' '}
                <span className="text-slate-500">(optional; defaults to service code)</span>
                <input
                  className={fields}
                  value={service.initialTariffCode}
                  onChange={(e) => setService({ ...service, initialTariffCode: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            Facility ID
            <input className={fields} readOnly value={facilityId} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={service.isActive}
              onChange={(e) => setService({ ...service, isActive: e.target.checked })}
            />{' '}
            Active service
          </label>
          <label>
            <input
              type="checkbox"
              checked={service.autoBill}
              onChange={(e) => setService({ ...service, autoBill: e.target.checked })}
            />{' '}
            Automatic billing enabled
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button className={button} disabled={busy || !canManage || needsVerification}>
              Save service
            </button>
            <button type="button" disabled={busy} onClick={() => setServiceOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {tariffOpen && (
        <form
          onSubmit={saveTariff}
          className="grid gap-4 rounded-xl border border-teal-200 bg-teal-50/30 p-4 shadow-sm sm:grid-cols-2 sm:p-5"
        >
          <h3 className="font-bold sm:col-span-2">{tariffEdit ? 'Edit tariff' : 'Add tariff'}</h3>
          <label>
            Service
            <select
              required
              className={fields}
              value={tariff.serviceId}
              disabled={Boolean(
                tariffEdit && tariffs.find((t) => t.id === tariffEdit)?.facilityServiceId,
              )}
              onChange={(e) => {
                const selected = services.find((s) => s.id === Number(e.target.value));
                setTariff({
                  ...tariff,
                  serviceId: e.target.value,
                  department: selected?.department ?? '',
                  unit: selected?.unit ?? '',
                });
              }}
            >
              <option value="">Select facility service</option>
              {services.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} — {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tariff code
            <input
              required
              className={fields}
              value={tariff.code}
              onChange={(e) => setTariff({ ...tariff, code: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2">
            Tariff description
            <input
              required
              className={fields}
              value={tariff.description}
              onChange={(e) => setTariff({ ...tariff, description: e.target.value })}
            />
          </label>
          <label>
            Department
            <input required className={fields} value={tariff.department} readOnly />
          </label>
          <label>
            Billing unit
            <input required className={fields} value={tariff.unit} readOnly />
          </label>
          <label>
            Price (KES)
            <input
              required
              inputMode="decimal"
              className={fields}
              value={tariff.fee}
              onChange={(e) => setTariff({ ...tariff, fee: e.target.value })}
            />
          </label>
          <label>
            Effective from
            <input
              type="date"
              className={fields}
              value={tariff.effectiveFrom}
              onChange={(e) => setTariff({ ...tariff, effectiveFrom: e.target.value })}
            />
          </label>
          <label>
            Effective to
            <input
              type="date"
              className={fields}
              value={tariff.effectiveTo}
              onChange={(e) => setTariff({ ...tariff, effectiveTo: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={tariff.isActive}
              onChange={(e) => setTariff({ ...tariff, isActive: e.target.checked })}
            />{' '}
            Active tariff
          </label>
          <label>
            <input
              type="checkbox"
              checked={tariff.autoBill}
              onChange={(e) => setTariff({ ...tariff, autoBill: e.target.checked })}
            />{' '}
            Automatic billing enabled
          </label>
          <p className="sm:col-span-2 text-slate-600">
            Only one active tariff may be used per service. Archiving retains a tariff; deletion is
            permanent and subject to safety checks.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button className={button} disabled={busy || !canManage || needsVerification}>
              Save tariff
            </button>
            <button type="button" disabled={busy} onClick={() => setTariffOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <FacilityServicesTable
        rows={services}
        loading={loading}
        hasError={Boolean(error)}
        canManage={canManage}
        busy={busy || needsVerification || serviceOpen || tariffOpen}
        onEdit={editService}
        onToggle={(row) =>
          void run(
            () => api.setFacilityServiceStatus(row.id, facilityId, !row.isActive),
            'Service status saved.',
          )
        }
        onDelete={(row) => {
          if (
            window.confirm(
              `Permanently delete service ${row.code} and its associated tariffs from the database? This cannot be undone. Some linked records block deletion; review clinical and billing history first.`,
            )
          )
            void run(async () => {
              await api.deleteFacilityService(row.id, facilityId);
              if (serviceEdit === row.id) {
                setServiceOpen(false);
                setServiceEdit(null);
                setServiceExpected(null);
              }
              setTariffOpen(false);
              setTariffEdit(null);
              setTariffRevision(null);
            }, `Service ${row.code} and its unused tariffs were permanently deleted.`);
        }}
      />
      <FacilityTariffsTable
        rows={visibleTariffs}
        services={services}
        loading={loading}
        hasError={Boolean(error)}
        canManage={canManage}
        busy={busy || needsVerification || serviceOpen || tariffOpen}
        onEdit={editTariff}
        onToggle={(row) =>
          void run(
            () => api.setFacilityTariffStatus(row.id, facilityId, !row.isActive),
            'Tariff status saved.',
          )
        }
        onArchive={(row) => {
          if (window.confirm(`Archive tariff ${row.code}? Existing invoices will be retained.`))
            void run(() => api.archiveFacilityTariff(row.id, facilityId), 'Tariff archived.');
        }}
        onDelete={(row) => {
          if (
            window.confirm(
              `Permanently delete tariff ${row.code} from the database? This cannot be undone and may affect pending billing. Some linked records block deletion; review billing and payer history first.`,
            )
          )
            void run(async () => {
              await api.deleteFacilityTariff(row.id, facilityId);
              if (tariffEdit === row.id) {
                setTariffOpen(false);
                setTariffEdit(null);
                setTariffRevision(null);
              }
            }, `Tariff ${row.code} was permanently deleted.`);
        }}
      />
    </section>
  );
};
