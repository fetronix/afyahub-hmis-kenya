import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import type { LabTest, ServiceTariff } from "../../types/index.ts";
import {
  BILLING_FAMILIES as BILLING_LINK_FAMILIES,
  buildBillingKey,
  labTariffCodeCandidates,
} from "../../billing/tariff-codes.ts";

interface FacilityServiceTariffsPanelProps {
  facilityId: number;
  facilityName: string;
  enabledModules: string[];
}

const DEPARTMENTS = [
  { id: "opd", label: "OPD / Outpatient" },
  { id: "inpatient", label: "Inpatient" },
  { id: "theatre", label: "Theatre" },
  { id: "specialty", label: "Specialty" },
  { id: "laboratory", label: "Laboratory" },
  { id: "radiology", label: "Radiology" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "registration", label: "Registration" },
  { id: "reception", label: "Reception" },
  { id: "insurance", label: "Insurance / SHA" },
  { id: "finance", label: "Finance / General" },
];

const SHA_STATUSES = [
  "Not Assessed",
  "Covered",
  "Not Covered",
  "Pre-Authorization Required",
  "Conditional",
];

/*
 * The families the automatic billing prices, and the codes it tries for
 * each. Kept beside the screen the codes are typed on, because the only
 * way to answer "will my visit bill?" is to compare the two.
 */
const BILLING_FAMILIES: Array<{
  key: string;
  label: string;
  codes: string[];
  prefixes: string[];
}> = [
  { key: "CONSULTATION", label: "Consultation", codes: ["OPD-CONSULT", "CONSULTATION", "CONSULT", "OUTPATIENT"], prefixes: ["CONSULT-"] },
  { key: "LABORATORY", label: "Laboratory", codes: ["LAB-GENERAL", "LABORATORY"], prefixes: ["LAB-"] },
  { key: "RADIOLOGY", label: "Radiology", codes: ["RAD-GENERAL", "RADIOLOGY", "IMAGING"], prefixes: ["RAD-"] },
  { key: "PROCEDURE", label: "Procedure", codes: ["PROCEDURE", "PROC-GENERAL"], prefixes: ["PROC-"] },
  { key: "PHARMACY", label: "Pharmacy", codes: ["PHARMACY", "MEDICATION"], prefixes: ["DRUG-"] },
  { key: "ADMISSION", label: "Admission", codes: ["ADMISSION", "INPATIENT-ADMISSION"], prefixes: ["ADMIT-"] },
  { key: "BED_DAY", label: "Bed-day", codes: ["BED-DAY", "INPATIENT-BED-DAY", "WARD-DAY", "BED"], prefixes: ["BED-"] },
  { key: "DELIVERY", label: "Maternity delivery", codes: ["DELIVERY", "MATERNITY-DELIVERY"], prefixes: ["DELIVERY-"] },
];

const EMPTY_FORM = {
  code: "",
  description: "",
  department: "opd",
  unit: "Service",
  fee: "",
  shaStatus: "Not Assessed",
  shaNotes: "",
  /*
   * Which automatic charge this tariff answers. A facility numbers its
   * tariffs (OPD-001, LAB-006); the engine looks for codes (OPD-CONSULT,
   * LAB-CBC). This is where the two are connected, once, by the person
   * who knows what OPD-001 actually is.
   */
  billingFamily: "",
  billingDetail: "",
};

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export const FacilityServiceTariffsPanel: React.FC<
  FacilityServiceTariffsPanelProps
> = ({ facilityId, facilityName, enabledModules }) => {
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [labTests, setLabTests] = useState<LabTest[]>([]);

  const departments = DEPARTMENTS.filter(({ id }) =>
    enabledModules.includes(id),
  );
  const financeEnabled = enabledModules.includes("finance");

  /*
   * A family is priced when at least one active tariff matches one of its
   * codes, or starts with one of its prefixes (`LAB-CBC` prices the
   * laboratory family even without a `LAB-GENERAL` fallback).
   */
  const coverage = BILLING_FAMILIES.map((family) => {
    /*
     * Two ways a family can be priced: a tariff whose *code* matches what
     * the engine looks for, or a tariff the facility explicitly linked to
     * this automatic charge. The second is what makes a numbered price
     * list (OPD-001) bill at all.
     */
    const match =
      tariffs.find(
        (tariff) =>
          tariff.isActive &&
          (tariff.billingKey ?? "").split(":")[0] === family.key,
      ) ??
      tariffs.find(
        (tariff) =>
          tariff.isActive &&
          (family.codes.includes(tariff.code.toUpperCase()) ||
            family.prefixes.some((prefix) =>
              tariff.code.toUpperCase().startsWith(prefix),
            )),
      );

    return { ...family, match: match ?? null };
  });
  const unpriced = coverage.filter((entry) => !entry.match);

  /*
   * The same question, one level down: which tests in this facility's own
   * laboratory catalogue would bill nothing today? A generic LAB-GENERAL
   * tariff prices all of them, so the check runs the engine's own
   * candidate list rather than comparing one code.
   */
  const activeTariffCodes = new Set(
    tariffs
      .filter((tariff) => tariff.isActive)
      .map((tariff) => tariff.code.trim().toUpperCase()),
  );

  const unpricedLabTests = labTests
    .filter((test) => test.isActive !== false)
    .filter((test) => {
      const candidates = labTariffCodeCandidates({
        code: test.code,
        name: test.name,
      });

      return !candidates.some((candidate) =>
        activeTariffCodes.has(candidate.toUpperCase()),
      );
    });

  const loadTariffs = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await api.getServiceTariffs(facilityId);
      setTariffs(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load this facility's tariffs.",
      );
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadTariffs();
  }, [loadTariffs]);

  /*
   * The laboratory catalogue, best effort.
   *
   * Reading it needs `laboratory.read`, which a facility administrator
   * may not hold. A refusal is not an error on this screen: the tariff
   * list still works, and the per-test section simply does not appear.
   */
  useEffect(() => {
    let cancelled = false;

    if (!enabledModules.includes("laboratory")) {
      setLabTests([]);
      return;
    }

    api
      .getLabTests(facilityId)
      .then((rows) => {
        if (!cancelled) setLabTests(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setLabTests([]);
      });

    return () => {
      cancelled = true;
    };
  }, [facilityId, enabledModules]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      department: departments[0]?.id || "opd",
    });
    setFormOpen(false);
  };

  const startEdit = (tariff: ServiceTariff) => {
    setEditingId(tariff.id);
    const [family = "", ...rest] = (tariff.billingKey ?? "").split(":");

    setForm({
      code: tariff.code,
      description: tariff.description,
      department: tariff.department,
      unit: tariff.unit,
      fee: String(tariff.fee),
      shaStatus: tariff.shaStatus,
      shaNotes: tariff.shaNotes || "",
      billingFamily: family,
      billingDetail: rest.join(":"),
    });
    setFormOpen(true);
    setError("");
    setNotice("");
  };

  const saveTariff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!financeEnabled) {
      setError("Enable the Finance module and save facility settings first.");
      return;
    }

    if (!departments.some(({ id }) => id === form.department)) {
      setError("Choose a department enabled for this facility.");
      return;
    }

    const feeText = form.fee.trim();
    const fee = Number(feeText);

    if (
      !Number.isFinite(fee) ||
      fee < 0 ||
      !/^\d{1,8}(\.\d{1,2})?$/.test(feeText)
    ) {
      setError("Enter a valid non-negative fee with up to two decimal places.");
      return;
    }

    setSaving(true);

    try {
      const input = {
        facilityId,
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        department: form.department,
        unit: form.unit.trim(),
        fee: fee.toFixed(2),
        shaStatus: form.shaStatus,
        shaNotes: form.shaNotes.trim() || null,
        billingKey: buildBillingKey(form.billingFamily, form.billingDetail),
      };

      if (editingId !== null) {
        await api.updateServiceTariff(editingId, input);
        setNotice("Service tariff updated. New invoices will use the updated fee.");
      } else {
        await api.createServiceTariff(input);
        setNotice("Service tariff created.");
      }

      resetForm();
      await loadTariffs();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save this service tariff.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deactivateTariff = async (tariff: ServiceTariff) => {
    if (!tariff.isActive) return;

    const confirmed = window.confirm(
      `Deactivate ${tariff.code} — ${tariff.description}? Existing invoice records will not be edited.`,
    );
    if (!confirmed) return;

    setError("");
    setNotice("");

    try {
      await api.deactivateServiceTariff(tariff.id, facilityId);
      setNotice(`Tariff ${tariff.code} deactivated.`);
      await loadTariffs();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not deactivate this tariff.",
      );
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Services &amp; Tariffs</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage the service catalogue and prices for {facilityName}.
            Price changes apply to newly created invoices; existing invoice
            line snapshots must remain unchanged.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setError("");
            setNotice("");
            if (formOpen) {
              resetForm();
            } else {
              setEditingId(null);
              setForm({
                ...EMPTY_FORM,
                department: departments[0]?.id || "opd",
              });
              setFormOpen(true);
            }
          }}
          disabled={!financeEnabled || departments.length === 0}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formOpen ? "Close form" : "Add service tariff"}
        </button>
      </div>

      {!financeEnabled && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The Finance module is not enabled for this facility. Enable it under
          Facility Module Settings and save before managing tariffs.
        </p>
      )}

      {financeEnabled && departments.length === 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No supported tariff departments are enabled. Enable the relevant
          facility modules and save the settings first.
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => void loadTariffs()}
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {/*
        The billing engine matches a service to a tariff by code. A
        facility that prices "Consultation" rather than "OPD-CONSULT"
        records the visit and bills nothing, so the codes it looks for
        are written where the codes are typed.
      */}
      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-800">
          Codes the automatic billing looks for
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          The first active tariff whose code matches wins. A service with no
          matching code is recorded on the clinical record and <strong>not</strong> billed.
        </p>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-800">
            This facility right now:{" "}
            {unpriced.length === 0 ? (
              <span className="text-emerald-700">every family below is priced</span>
            ) : (
              <span className="text-amber-700">
                {unpriced.length} of {coverage.length} families have no matching tariff
              </span>
            )}
          </p>

          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {coverage.map((entry) => (
              <li
                key={entry.label}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="text-slate-600">{entry.label}</span>
                {entry.match ? (
                  <span className="font-mono text-emerald-700">
                    {entry.match.code} · {entry.match.fee}
                  </span>
                ) : (
                  <span className="text-amber-700">not priced</span>
                )}
              </li>
            ))}
          </ul>

          {unpriced.length > 0 && (
            <p className="mt-2 text-2xs leading-relaxed text-slate-500">
              An unpriced service is recorded, and appears on the invoice only
              when a price is found. Either add a fallback code such as{" "}
              <span className="font-mono">OPD-CONSULT</span>, or edit a tariff you
              already have and set <strong>Used for automatic billing</strong> —
              that links <span className="font-mono">OPD-001</span> to the
              consultation without renaming anything.
            </p>
          )}
        </div>

        {labTests.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-800">
              Laboratory tests in this catalogue:{" "}
              {unpricedLabTests.length === 0 ? (
                <span className="text-emerald-700">all priced</span>
              ) : (
                <span className="text-amber-700">
                  {unpricedLabTests.length} of {labTests.length} would bill nothing
                </span>
              )}
            </p>

            {unpricedLabTests.length > 0 && (
              <>
                <p className="mt-1 text-2xs leading-relaxed text-slate-500">
                  Selecting the test prices it from the tariff screen, not from
                  the price held in the laboratory catalogue. Choosing one below
                  fills the code the engine will look for; you still set the fee.
                </p>

                <ul className="mt-2 space-y-1">
                  {unpricedLabTests.slice(0, 12).map((test) => (
                    <li
                      key={test.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="text-slate-600">
                        {test.name}{" "}
                        <span className="font-mono text-2xs text-slate-400">
                          {test.code}
                        </span>
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          setError("");
                          setNotice("");
                          setEditingId(null);
                          setForm({
                            ...EMPTY_FORM,
                            department: "laboratory",
                            code: test.code.toUpperCase(),
                            description: test.name,
                          });
                          setFormOpen(true);
                        }}
                        className="rounded-md border border-blue-200 bg-white px-2 py-1 text-2xs font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Set a price
                      </button>
                    </li>
                  ))}
                </ul>

                {unpricedLabTests.length > 12 && (
                  <p className="mt-1 text-2xs text-slate-400">
                    and {unpricedLabTests.length - 12} more.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-700">Consultation</dt>
            <dd className="font-mono text-xs text-slate-600">OPD-CONSULT · CONSULTATION · CONSULT · CONSULT-&lt;VISIT TYPE&gt;</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Laboratory</dt>
            <dd className="font-mono text-xs text-slate-600">LAB-&lt;TEST NAME&gt; · LAB-GENERAL · LABORATORY</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Radiology</dt>
            <dd className="font-mono text-xs text-slate-600">RAD-&lt;STUDY NAME&gt; · RAD-GENERAL · RADIOLOGY · IMAGING</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Procedure</dt>
            <dd className="font-mono text-xs text-slate-600">PROC-&lt;NAME&gt; · PROCEDURE · PROC-GENERAL</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Pharmacy</dt>
            <dd className="font-mono text-xs text-slate-600">DRUG-&lt;DRUG NAME&gt; · &lt;DRUG NAME&gt; · PHARMACY · MEDICATION</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Admission</dt>
            <dd className="font-mono text-xs text-slate-600">ADMIT-&lt;WARD CODE&gt; · ADMISSION · INPATIENT-ADMISSION</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Bed-day (per night)</dt>
            <dd className="font-mono text-xs text-slate-600">BED-&lt;WARD CODE&gt; · BED-DAY · INPATIENT-BED-DAY · WARD-DAY · BED</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Maternity delivery</dt>
            <dd className="font-mono text-xs text-slate-600">DELIVERY · DELIVERY-&lt;MODE&gt; · MATERNITY-DELIVERY</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          &lt;NAME&gt; is the record&apos;s own text with spaces and punctuation turned
          into dashes and upper-cased — a wound dressing priced as
          <span className="font-mono"> PROC-WOUND-DRESSING</span> bills itself.
        </p>
      </details>

      {formOpen && (
        <form
          onSubmit={saveTariff}
          className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2"
        >
          <div>
            <label className={labelClass} htmlFor={`tariff-code-${facilityId}`}>
              Service code *
            </label>
            <input
              id={`tariff-code-${facilityId}`}
              className={fieldClass}
              value={form.code}
              onChange={(event) =>
                setForm((current) => ({ ...current, code: event.target.value }))
              }
              maxLength={50}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`tariff-unit-${facilityId}`}>
              Unit *
            </label>
            <input
              id={`tariff-unit-${facilityId}`}
              className={fieldClass}
              value={form.unit}
              onChange={(event) =>
                setForm((current) => ({ ...current, unit: event.target.value }))
              }
              maxLength={50}
              placeholder="Service, test, visit, item..."
              required
            />
          </div>

          {/*
            The link that makes automatic billing work for a numbered price
            list. Without it the engine can only match the code it guessed,
            and OPD-001 never matches OPD-CONSULT.
          */}
          <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
            <label className={labelClass} htmlFor={`tariff-billing-${facilityId}`}>
              Used for automatic billing
            </label>

            <select
              id={`tariff-billing-${facilityId}`}
              className={fieldClass}
              value={form.billingFamily}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billingFamily: event.target.value,
                  billingDetail:
                    event.target.value === "" ? "" : current.billingDetail,
                }))
              }
            >
              <option value="">Not linked — priced only when the code matches</option>
              {BILLING_LINK_FAMILIES.map((family) => (
                <option key={family.key} value={family.key}>
                  {family.label}
                </option>
              ))}
            </select>

            {form.billingFamily !== "" && (
              <div className="mt-2">
                <label
                  className="mb-1 block text-xs font-medium text-slate-600"
                  htmlFor={`tariff-billing-detail-${facilityId}`}
                >
                  Only for one service (optional)
                </label>
                <input
                  id={`tariff-billing-detail-${facilityId}`}
                  className={fieldClass}
                  value={form.billingDetail}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      billingDetail: event.target.value,
                    }))
                  }
                  maxLength={80}
                  placeholder="e.g. Full blood count, or LAB-CBC — leave empty for any"
                />
                <p className="mt-1 text-2xs leading-relaxed text-slate-500">
                  Leave this empty when one price covers the whole family. Fill it
                  in when this tariff is for one test, study or procedure. It is
                  matched against the catalogue code or the name typed when the
                  service is ordered:{" "}
                  <span className="font-mono">
                    {buildBillingKey(form.billingFamily, form.billingDetail) ??
                      form.billingFamily}
                  </span>
                </p>
              </div>
            )}

            <p className="mt-2 text-2xs leading-relaxed text-blue-900">
              One active tariff per family. A tariff linked here is charged
              automatically the moment the service is recorded, so the amount on
              the invoice is the amount you typed above.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className={labelClass} htmlFor={`tariff-description-${facilityId}`}>
              Service description *
            </label>
            <input
              id={`tariff-description-${facilityId}`}
              className={fieldClass}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              maxLength={500}
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`tariff-department-${facilityId}`}>
              Department *
            </label>
            <select
              id={`tariff-department-${facilityId}`}
              className={fieldClass}
              value={form.department}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  department: event.target.value,
                }))
              }
              required
            >
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor={`tariff-fee-${facilityId}`}>
              Fee (KES) *
            </label>
            <input
              id={`tariff-fee-${facilityId}`}
              className={fieldClass}
              type="number"
              min="0"
              max="99999999.99"
              step="0.01"
              inputMode="decimal"
              value={form.fee}
              onChange={(event) =>
                setForm((current) => ({ ...current, fee: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`tariff-sha-${facilityId}`}>
              SHA status *
            </label>
            <select
              id={`tariff-sha-${facilityId}`}
              className={fieldClass}
              value={form.shaStatus}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shaStatus: event.target.value,
                }))
              }
              required
            >
              {SHA_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className={labelClass} htmlFor={`tariff-notes-${facilityId}`}>
              SHA / billing notes
            </label>
            <textarea
              id={`tariff-notes-${facilityId}`}
              className={fieldClass}
              value={form.shaNotes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shaNotes: event.target.value,
                }))
              }
              maxLength={1000}
              rows={3}
            />
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={saving || !financeEnabled || departments.length === 0}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : editingId === null ? "Create tariff" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading facility tariffs...</p>
      ) : tariffs.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          No tariffs found for this facility. Add a service tariff to get started.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Code / Service</th>
                <th className="px-3 py-3 font-semibold">Department / Unit</th>
                <th className="px-3 py-3 text-right font-semibold">Fee (KES)</th>
                <th className="px-3 py-3 font-semibold">SHA status</th>
                <th className="px-3 py-3 font-semibold">Automatic billing</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tariffs.map((tariff) => (
                <tr key={tariff.id} className={!tariff.isActive ? "bg-slate-50 text-slate-500" : ""}>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-900">{tariff.code}</div>
                    <div>{tariff.description}</div>
                    {tariff.shaNotes && (
                      <div className="mt-1 text-xs text-slate-500">{tariff.shaNotes}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div>{tariff.department}</div>
                    <div className="text-xs text-slate-500">{tariff.unit}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                    {Number(tariff.fee).toLocaleString("en-KE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-3 py-3">{tariff.shaStatus}</td>
                  <td className="px-3 py-3">
                    {tariff.billingKey ? (
                      <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-2xs font-semibold text-emerald-800">
                        {tariff.billingKey}
                      </span>
                    ) : (
                      <span className="text-2xs text-slate-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {tariff.isActive ? "Active" : "Inactive"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(tariff)}
                        className="font-semibold text-blue-700 hover:underline"
                      >
                        Edit
                      </button>
                      {tariff.isActive && (
                        <button
                          type="button"
                          onClick={() => void deactivateTariff(tariff)}
                          className="font-semibold text-red-700 hover:underline"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
