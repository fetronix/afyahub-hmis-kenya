import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { FacilityService, ServiceTariff } from '../../types/index.ts';

const departmentNames: Record<string, string> = {
  opd: 'OPD',
  laboratory: 'Laboratory',
  radiology: 'Radiology',
  pharmacy: 'Pharmacy',
  inpatient: 'Inpatient',
  maternity: 'Maternity',
  theatre: 'Theatre',
  specialty: 'Specialty',
  registration: 'Registration',
  reception: 'Reception',
  insurance: 'Insurance',
  finance: 'General / Finance',
};
const departmentName = (department: string) => departmentNames[department] ?? department;
const categoryName = (category: string) => category.replaceAll('_', ' ');
const matches = (query: string, values: Array<string | null | undefined>) => {
  const search = query.trim().toLocaleLowerCase();
  return !search || values.some((value) => value?.toLocaleLowerCase().includes(search));
};
const headingClass =
  'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';
const cellClass = 'border-t border-slate-100 px-4 py-3 align-top text-slate-700';
const actionClass =
  'rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-300 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
const deleteClass =
  'rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-50';

function Status({ status }: { status: 'Active' | 'Inactive' | 'Archived' }) {
  const colours =
    status === 'Active'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : status === 'Archived'
        ? 'bg-slate-100 text-slate-600 ring-slate-200'
        : 'bg-amber-50 text-amber-800 ring-amber-200';
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${colours}`}
    >
      {status}
    </span>
  );
}

function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600 sm:w-72">
      {label}
      <span className="relative mt-1 block">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 text-slate-400"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-2 focus:outline-teal-100"
        />
      </span>
    </label>
  );
}

type TableState = { loading: boolean; hasError: boolean; canManage: boolean; busy: boolean };
type ServiceTableProps = TableState & {
  rows: FacilityService[];
  onEdit: (row: FacilityService) => void;
  onToggle: (row: FacilityService) => void;
  onDelete: (row: FacilityService) => void;
};

export function FacilityServicesTable({
  rows,
  loading,
  hasError,
  canManage,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: ServiceTableProps) {
  const [query, setQuery] = useState('');
  const filtered = rows.filter((row) =>
    matches(query, [
      row.code,
      row.name,
      row.description,
      row.department,
      departmentName(row.department),
      row.category,
      categoryName(row.category),
      row.unit,
    ]),
  );
  return (
    <section
      aria-labelledby="facility-services-table-heading"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-end sm:px-5">
        <div>
          <h3 id="facility-services-table-heading" className="text-base font-bold text-slate-900">
            Services
          </h3>
          <p className="mt-1 text-xs text-slate-500">The services configured for this facility.</p>
          {!loading && !hasError && (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Showing {filtered.length} of {rows.length}
            </p>
          )}
        </div>
        <SearchField
          label="Search services"
          value={query}
          onChange={setQuery}
          placeholder="Search name, code or department"
        />
      </div>
      <p className="px-4 pb-3 text-xs text-slate-500 sm:hidden">
        Swipe horizontally to view all columns and actions.
      </p>
      <div
        role="region"
        aria-label="Scrollable services table"
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-teal-700"
      >
        <table
          aria-label="Facility services"
          aria-busy={loading}
          className="w-full min-w-[920px] border-collapse text-sm"
        >
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={headingClass}>
                Service
              </th>
              <th scope="col" className={headingClass}>
                Code
              </th>
              <th scope="col" className={headingClass}>
                Department / category
              </th>
              <th scope="col" className={headingClass}>
                Unit
              </th>
              <th scope="col" className={headingClass}>
                Auto-billing
              </th>
              <th scope="col" className={headingClass}>
                Status
              </th>
              <th scope="col" className={headingClass}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/70">
                <td className={cellClass}>
                  <div className="font-semibold text-slate-900">{row.name}</div>
                  <div className="mt-1 max-w-xs text-xs text-slate-500">{row.description}</div>
                </td>
                <td className={`${cellClass} font-mono text-xs font-semibold`}>{row.code}</td>
                <td className={cellClass}>
                  <div>{departmentName(row.department)}</div>
                  <div className="mt-1 text-xs text-slate-500">{categoryName(row.category)}</div>
                </td>
                <td className={cellClass}>{row.unit}</td>
                <td className={cellClass}>{row.autoBill ? 'On' : 'Off'}</td>
                <td className={cellClass}>
                  <Status status={row.isActive ? 'Active' : 'Inactive'} />
                </td>
                <td className={cellClass}>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={actionClass}
                      aria-label={`Edit service ${row.code}`}
                      disabled={!canManage || busy}
                      onClick={() => onEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={actionClass}
                      aria-label={`${row.isActive ? 'Deactivate' : 'Activate'} service ${row.code}`}
                      disabled={!canManage || busy}
                      onClick={() => onToggle(row)}
                    >
                      {row.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className={deleteClass}
                      aria-label={`Delete service ${row.code}`}
                      disabled={!canManage || busy}
                      onClick={() => onDelete(row)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !hasError && !filtered.length && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                  {rows.length
                    ? 'No services match your search.'
                    : 'No facility services have been created.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type TariffTableProps = TableState & {
  rows: ServiceTariff[];
  services: FacilityService[];
  onEdit: (row: ServiceTariff) => void;
  onToggle: (row: ServiceTariff) => void;
  onArchive: (row: ServiceTariff) => void;
  onDelete: (row: ServiceTariff) => void;
};

export function FacilityTariffsTable({
  rows,
  services,
  loading,
  hasError,
  canManage,
  busy,
  onEdit,
  onToggle,
  onArchive,
  onDelete,
}: TariffTableProps) {
  const [query, setQuery] = useState('');
  const byId = new Map(services.map((service) => [service.id, service]));
  const filtered = rows.filter((row) => {
    const service = row.facilityServiceId ? byId.get(row.facilityServiceId) : undefined;
    return matches(query, [
      row.code,
      row.description,
      row.department,
      departmentName(row.department),
      row.unit,
      row.fee,
      service?.name,
      service?.code,
    ]);
  });
  return (
    <section
      aria-labelledby="facility-tariffs-table-heading"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex flex-col justify-between gap-4 px-4 py-4 sm:flex-row sm:items-end sm:px-5">
        <div>
          <h3 id="facility-tariffs-table-heading" className="text-base font-bold text-slate-900">
            Tariffs
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Prices and effective dates are shown as stored. Active is a setting, not a billing
            eligibility check.
          </p>
          {!loading && !hasError && (
            <p className="mt-2 text-xs font-medium text-slate-500">
              Showing {filtered.length} of {rows.length}
            </p>
          )}
        </div>
        <SearchField
          label="Search tariffs"
          value={query}
          onChange={setQuery}
          placeholder="Search code, description or service"
        />
      </div>
      <p className="px-4 pb-3 text-xs text-slate-500 sm:hidden">
        Swipe horizontally to view all columns and actions.
      </p>
      <div
        role="region"
        aria-label="Scrollable tariffs table"
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-teal-700"
      >
        <table
          aria-label="Facility tariffs"
          aria-busy={loading}
          className="w-full min-w-[1100px] border-collapse text-sm"
        >
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={headingClass}>
                Tariff
              </th>
              <th scope="col" className={headingClass}>
                Service
              </th>
              <th scope="col" className={headingClass}>
                Department / unit
              </th>
              <th scope="col" className={headingClass}>
                Price
              </th>
              <th scope="col" className={headingClass}>
                Effective dates
              </th>
              <th scope="col" className={headingClass}>
                Auto-billing
              </th>
              <th scope="col" className={headingClass}>
                Status
              </th>
              <th scope="col" className={headingClass}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const service = row.facilityServiceId ? byId.get(row.facilityServiceId) : undefined;
              return (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className={cellClass}>
                    <div className="font-mono text-xs font-semibold text-slate-900">{row.code}</div>
                    <div className="mt-1 max-w-xs text-xs text-slate-500">{row.description}</div>
                  </td>
                  <td className={cellClass}>
                    {service ? (
                      <>
                        <div className="font-medium text-slate-900">{service.name}</div>
                        <div className="mt-1 font-mono text-xs text-slate-500">{service.code}</div>
                      </>
                    ) : row.facilityServiceId ? (
                      `Service #${row.facilityServiceId} unavailable`
                    ) : (
                      'Service not selected'
                    )}
                  </td>
                  <td className={cellClass}>
                    <div>{departmentName(row.department)}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.unit}</div>
                  </td>
                  <td className={`${cellClass} whitespace-nowrap font-semibold tabular-nums`}>
                    KES {row.fee}
                  </td>
                  <td className={`${cellClass} whitespace-nowrap text-xs`}>
                    <div>From: {row.effectiveFrom ?? 'Not set'}</div>
                    <div className="mt-1">To: {row.effectiveTo ?? 'Not set'}</div>
                  </td>
                  <td className={cellClass}>{row.autoBill ? 'On' : 'Off'}</td>
                  <td className={cellClass}>
                    <Status
                      status={row.archivedAt ? 'Archived' : row.isActive ? 'Active' : 'Inactive'}
                    />
                  </td>
                  <td className={cellClass}>
                    <div className="flex flex-wrap gap-1.5">
                      {!row.archivedAt && (
                        <>
                          <button
                            type="button"
                            className={actionClass}
                            aria-label={`Edit tariff ${row.code}`}
                            disabled={!canManage || busy}
                            onClick={() => onEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={actionClass}
                            aria-label={`${row.isActive ? 'Deactivate' : 'Activate'} tariff ${row.code}`}
                            disabled={!canManage || busy}
                            onClick={() => onToggle(row)}
                          >
                            {row.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            className={actionClass}
                            aria-label={`Archive tariff ${row.code}`}
                            disabled={!canManage || busy}
                            onClick={() => onArchive(row)}
                          >
                            Archive
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className={deleteClass}
                        aria-label={`Delete tariff ${row.code}`}
                        disabled={!canManage || busy}
                        onClick={() => onDelete(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && !hasError && !filtered.length && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                  {rows.length
                    ? 'No tariffs match your search.'
                    : 'No facility tariffs are available to manage.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
