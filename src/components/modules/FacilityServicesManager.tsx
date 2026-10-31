import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import type { FacilityService, ServiceTariff } from '../../types/index.ts';
import { FacilityBillingReview } from './FacilityBillingReview.tsx';

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
  department: 'opd',
  category: 'CONSULTATION',
  unit: 'Visit',
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
      : (departments.find(([id]) => enabledModules.includes(id))?.[0] ?? 'finance'),
  });
  const [services, setServices] = useState<FacilityService[]>([]);
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceEdit, setServiceEdit] = useState<number | null>(null);
  const [service, setService] = useState(blankService);
  const [tariffOpen, setTariffOpen] = useState(false);
  const [tariffEdit, setTariffEdit] = useState<number | null>(null);
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
      }
    } catch (err) {
      if (current === generation.current) {
        setServices([]);
        setTariffs([]);
        setError(err instanceof Error ? err.message : 'Unable to load facility services.');
      }
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
    if (busy || !canManage) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      triggerRefresh();
      if (successMessage) setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  function editService(row: FacilityService) {
    setServiceEdit(row.id);
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
    await run(async () => {
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
      if (serviceEdit) await api.updateFacilityService(serviceEdit, common);
      else
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
    });
  }
  async function saveTariff(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
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
      if (tariffEdit) await api.updateFacilityTariff(tariffEdit, input);
      else await api.createFacilityTariff(input);
      setTariffOpen(false);
      setTariff(blankTariff);
      setTariffEdit(null);
    });
  }
  // Master-only rows remain in PostgreSQL for history but are not a
  // facility service price list. Do not hide a tariff already attached to
  // a direct service: it may still be used by billing and must remain visible.
  const visibleTariffs = tariffs.filter(
    (row) => row.masterServiceId == null || row.facilityServiceId != null,
  );
  const fields = 'w-full rounded border border-slate-300 px-2 py-2';
  const button = 'rounded bg-teal-700 px-3 py-2 text-white disabled:opacity-50';
  return (
    <section className="space-y-4 text-sm" aria-label="Facility services and tariffs">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Facility Services &amp; Tariffs</h2>
          <p className="text-slate-600">
            Services and prices belong to facility #{facilityId}. Zero means unconfigured, not free.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={button}
            disabled={!canManage || busy}
            onClick={() => {
              setService(defaultService());
              setServiceEdit(null);
              setServiceOpen(true);
            }}
          >
            Add service
          </button>
          <button
            className={button}
            disabled={!canManage || busy || !services.length}
            onClick={() => {
              setTariff(blankTariff);
              setTariffEdit(null);
              setTariffOpen(true);
            }}
          >
            Add tariff
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-rose-800">
          {error}
        </p>
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
      {serviceOpen && (
        <form
          onSubmit={saveService}
          className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-2"
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
              className={fields}
              disabled={serviceEdit !== null}
              value={service.department}
              onChange={(e) => setService({ ...service, department: e.target.value })}
            >
              {departments
                .filter(([id]) => enabledModules.includes(id))
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
              className={fields}
              disabled={serviceEdit !== null}
              value={service.category}
              onChange={(e) => setService({ ...service, category: e.target.value })}
            >
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
            <button className={button} disabled={busy || !canManage}>
              Save service
            </button>
            <button type="button" onClick={() => setServiceOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {tariffOpen && (
        <form
          onSubmit={saveTariff}
          className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-2"
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
            Only one active tariff may be used per service. Archived and historical tariff records
            remain in the database.
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button className={button} disabled={busy || !canManage}>
              Save tariff
            </button>
            <button type="button" onClick={() => setTariffOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="rounded border bg-white p-4">
        <h3 className="font-bold">Services</h3>
        {!loading && !error && !services.length && <p>No facility services have been created.</p>}
        {services.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t py-2"
          >
            <div>
              <b>{row.code}</b> — {row.name} · {row.department} · {row.unit} ·{' '}
              {row.isActive ? 'Active' : 'Inactive'}
            </div>
            <div className="flex gap-3">
              <button disabled={!canManage || busy} onClick={() => editService(row)}>
                Edit
              </button>
              <button
                disabled={!canManage || busy}
                onClick={() =>
                  void run(() => api.setFacilityServiceStatus(row.id, facilityId, !row.isActive))
                }
              >
                {row.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button
                type="button"
                className="text-rose-700 disabled:opacity-50"
                aria-label={`Delete service ${row.code}`}
                disabled={!canManage || busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Permanently delete service ${row.code} and its associated tariffs from the database? This cannot be undone. Records used by clinical, billing or payer history cannot be deleted.`,
                    )
                  )
                    void run(async () => {
                      await api.deleteFacilityService(row.id, facilityId);
                      if (serviceEdit === row.id) {
                        setServiceOpen(false);
                        setServiceEdit(null);
                      }
                      setTariffOpen(false);
                      setTariffEdit(null);
                    }, `Service ${row.code} and its unused tariffs were permanently deleted.`);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded border bg-white p-4">
        <h3 className="font-bold">Tariffs</h3>
        <p className="text-slate-600">
          Manage facility prices here. Historical pricing records are retained.
        </p>
        {!loading && !error && !visibleTariffs.length && (
          <p>No facility tariffs are available to manage.</p>
        )}
        {visibleTariffs.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t py-2"
          >
            <div>
              <b>{row.code}</b> — {row.description} · KES {row.fee} / {row.unit} ·{' '}
              {row.archivedAt ? 'Archived' : row.isActive ? 'Active' : 'Inactive'}
              {!row.facilityServiceId && ' · service not selected'}
            </div>
            <div className="flex gap-3">
              {!row.archivedAt && (
                <>
                  <button disabled={!canManage || busy} onClick={() => editTariff(row)}>
                    Edit
                  </button>
                  <button
                    disabled={!canManage || busy}
                    onClick={() =>
                      void run(() => api.setFacilityTariffStatus(row.id, facilityId, !row.isActive))
                    }
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    disabled={!canManage || busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Archive tariff ${row.code}? Existing invoices will be retained.`,
                        )
                      )
                        void run(() => api.archiveFacilityTariff(row.id, facilityId));
                    }}
                  >
                    Archive
                  </button>
                </>
              )}
              <button
                type="button"
                className="text-rose-700 disabled:opacity-50"
                aria-label={`Delete tariff ${row.code}`}
                disabled={!canManage || busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Permanently delete tariff ${row.code} from the database? This cannot be undone and may affect pending billing. Tariffs linked to billing, payer or historical records cannot be deleted.`,
                    )
                  )
                    void run(async () => {
                      await api.deleteFacilityTariff(row.id, facilityId);
                      if (tariffEdit === row.id) {
                        setTariffOpen(false);
                        setTariffEdit(null);
                      }
                    }, `Tariff ${row.code} was permanently deleted.`);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <FacilityBillingReview key={facilityId} facilityId={facilityId} canManage={canManage} />
    </section>
  );
};
