import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import type {
  BillingChargeAttempt,
  BillingChargeAttemptList,
  LabServiceDiagnostics,
  LabTest,
  ServiceTariff,
  ServiceTariffLink,
  Ward,
} from "../../types/index.ts";
import {
  BILLING_FAMILIES as BILLING_LINK_FAMILIES,
  buildBillingKey,
  labTariffCodeCandidates,
  type BillingFamily,
} from "../../billing/tariff-codes.ts";
import {
  codesForFamily,
  consultationPhrases,
  matchTariff,
} from "../../billing/tariff-matching.ts";

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
type BillingFamilyRow = {
  key: BillingFamily;
  label: string;
  encounterType?: string;
  /** Generic descriptions a family-wide tariff may legitimately carry. */
  phrases: string[];
  /** Code families that indicate a *specific* price, not a fallback. */
  prefixes: string[];
  codes: string[];
};

const BILLING_FAMILIES: BillingFamilyRow[] = ([
  {
    key: "CONSULTATION",
    label: "Consultation",
    encounterType: "OUTPATIENT",
    phrases: consultationPhrases("OUTPATIENT"),
    prefixes: ["CONSULT-"],
    codes: [],
  },
  { key: "LABORATORY", label: "Laboratory", phrases: [], prefixes: ["LAB-"], codes: [] },
  { key: "RADIOLOGY", label: "Radiology", phrases: [], prefixes: ["RAD-"], codes: [] },
  { key: "PROCEDURE", label: "Procedure", phrases: [], prefixes: ["PROC-"], codes: [] },
  { key: "PHARMACY", label: "Pharmacy", phrases: [], prefixes: ["DRUG-"], codes: [] },
  { key: "ADMISSION", label: "Admission", phrases: [], prefixes: ["ADMIT-"], codes: [] },
  { key: "BED_DAY", label: "Bed-day", phrases: [], prefixes: ["BED-"], codes: [] },
  { key: "DELIVERY", label: "Maternity delivery", phrases: [], prefixes: ["DELIVERY-"], codes: [] },
] satisfies BillingFamilyRow[]).map((family) => ({
  ...family,
  /*
   * The exact list the engine tries, not a copy maintained by hand. A
   * copy is how this screen once promised codes the engine never used.
   */
  codes: codesForFamily({
    family: family.key,
    encounterType: family.encounterType ?? null,
  }),
}));

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
  /*
   * When this price applies, and whether automatic billing may use it.
   * Empty dates mean "always"; automatic billing is on by default so
   * saving a tariff behaves exactly as it did before these fields.
   */
  effectiveFrom: "",
  effectiveTo: "",
  autoBill: true,
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
  /*
   * Wards, for a bed-day link. A bed-day link names a ward: "this ward's
   * night is priced by IP-002". A family-wide bed-day link is possible
   * but only prices general beds, which is why the picker asks for one.
   */
  const [wards, setWards] = useState<Ward[]>([]);
  /*
   * Charges the engine could not price. These are owed: the visit, the
   * order or the admission happened. Keeping them on this screen is the
   * point — a skipped charge that nobody can see is money lost quietly.
   */
  const [attempts, setAttempts] =
    useState<BillingChargeAttemptList | null>(null);
  const [attemptsUnavailable, setAttemptsUnavailable] = useState("");
  const [attemptBusy, setAttemptBusy] = useState<number | "all" | null>(null);
  const [attemptNotice, setAttemptNotice] = useState("");
  const [attemptExplanation, setAttemptExplanation] = useState<{
    id: number;
    text: string;
  } | null>(null);

  /*
   * Catalogue service → tariff links (migration 0021) and the
   * laboratory diagnostics that run the resolver over every test in
   * this facility. Together they answer "why did my order not bill?"
   * with the facility's own rows instead of a code it never typed.
   */
  const [links, setLinks] = useState<ServiceTariffLink[]>([]);
  const [linksUnavailable, setLinksUnavailable] = useState("");
  const [diagnostics, setDiagnostics] =
    useState<LabServiceDiagnostics | null>(null);
  const [diagnosticsUnavailable, setDiagnosticsUnavailable] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState("");
  const [linkDraft, setLinkDraft] = useState<{
    testId: number | null;
    wardId: number | null;
    serviceType: string;
    tariffId: string;
    autoBill: boolean;
  }>({
    testId: null,
    wardId: null,
    serviceType: "LAB_TEST",
    tariffId: "",
    autoBill: true,
  });

  const departments = DEPARTMENTS.filter(({ id }) =>
    enabledModules.includes(id),
  );
  const financeEnabled = enabledModules.includes("finance");

  /*
   * Which families this facility can actually bill.
   *
   * The same function the billing engine runs, over the same rows, so
   * "Consultation — OPD-001 · 150" here means the next OPD visit really
   * produces a 150 line. A family a tariff only covers per service
   * (LAB-CBC prices CBC, not every test) is shown as such rather than
   * being counted as full coverage.
   */
  const coverage = BILLING_FAMILIES.map((family) => {
    const outcome = matchTariff({
      rows: tariffs.map((tariff) => ({
        id: tariff.id,
        code: tariff.code,
        description: tariff.description,
        fee: tariff.fee,
        unit: tariff.unit,
        department: tariff.department,
        billingKey: tariff.billingKey ?? null,
        isActive: tariff.isActive,
      })),
      codes: family.codes,
      serviceKeys: [family.key],
      family: family.key,
      phrases: family.phrases,
    });

    const specific = tariffs.filter(
      (tariff) =>
        tariff.isActive &&
        ((tariff.billingKey ?? "").split(":")[0] === family.key ||
          family.prefixes.some((prefix) =>
            tariff.code.toUpperCase().startsWith(prefix),
          )),
    );

    return {
      ...family,
      match: outcome.tariff,
      rule: outcome.rule,
      ambiguity: outcome.ambiguity,
      specific,
    };
  });

  const unpriced = coverage.filter(
    (entry) => !entry.match && entry.specific.length === 0,
  );

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

  const loadLinks = useCallback(async () => {
    try {
      const rows = await api.getServiceTariffLinks(facilityId);
      setLinks(Array.isArray(rows) ? rows : []);
      setLinksUnavailable("");
    } catch (err) {
      setLinks([]);
      setLinksUnavailable(
        err instanceof Error
          ? err.message
          : "Service links are not visible with your permissions.",
      );
    }
  }, [facilityId]);

  const loadDiagnostics = useCallback(async () => {
    if (!enabledModules.includes("laboratory")) {
      setDiagnostics(null);
      return;
    }

    try {
      const result = await api.getLabServiceDiagnostics(facilityId);
      setDiagnostics(result);
      setDiagnosticsUnavailable("");
    } catch (err) {
      setDiagnostics(null);
      setDiagnosticsUnavailable(
        err instanceof Error
          ? err.message
          : "Laboratory diagnostics are not available with your permissions.",
      );
    }
  }, [facilityId, enabledModules]);

  useEffect(() => {
    void loadLinks();
    void loadDiagnostics();
  }, [loadLinks, loadDiagnostics]);

  const saveLink = async () => {
    const tariffId = Number(linkDraft.tariffId);

    if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
      setLinkNotice("Choose the tariff that should price this service.");
      return;
    }

    if (linkDraft.serviceType === "LAB_TEST" && linkDraft.testId === null) {
      setLinkNotice("Choose the laboratory test to link.");
      return;
    }

    if (linkDraft.serviceType === "BED_DAY" && linkDraft.wardId === null) {
      setLinkNotice(
        "Choose the ward to link. A ward link prices that ward's nights; a category-wide rate is found by the tariff's own description.",
      );
      return;
    }

    setLinkBusy(true);
    setLinkNotice("");

    try {
      await api.createServiceTariffLink({
        facilityId,
        serviceType: linkDraft.serviceType,
        serviceId:
          linkDraft.serviceType === "BED_DAY"
            ? linkDraft.wardId
            : linkDraft.testId,
        tariffId,
        autoBill: linkDraft.autoBill,
      });

      setLinkNotice("Linked. The next charge for this service uses that tariff.");
      setLinkDraft((current) => ({
        ...current,
        testId: null,
        wardId: null,
        tariffId: "",
      }));
      await loadLinks();
      await loadDiagnostics();
    } catch (err) {
      setLinkNotice(
        err instanceof Error ? err.message : "The link could not be saved.",
      );
    } finally {
      setLinkBusy(false);
    }
  };

  const removeLink = async (link: ServiceTariffLink) => {
    setLinkBusy(true);
    setLinkNotice("");

    try {
      await api.deactivateServiceTariffLink(link.id, facilityId);
      setLinkNotice("Link retired. The history is kept; the charge falls back to codes.");
      await loadLinks();
      await loadDiagnostics();
    } catch (err) {
      setLinkNotice(
        err instanceof Error ? err.message : "The link could not be retired.",
      );
    } finally {
      setLinkBusy(false);
    }
  };

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

  const loadAttempts = useCallback(async () => {
    try {
      const result = await api.getChargeAttempts(facilityId);
      setAttempts(result);
      setAttemptsUnavailable("");
    } catch (err) {
      /*
       * Reading the queue needs `billing.read`. A facility administrator
       * who does not hold it should still be able to manage prices, so a
       * refusal hides the queue with an explanation instead of breaking
       * the screen.
       */
      setAttempts(null);
      setAttemptsUnavailable(
        err instanceof Error
          ? err.message
          : "Unbilled charges are not visible with your permissions.",
      );
    }
  }, [facilityId]);

  useEffect(() => {
    void loadAttempts();
  }, [loadAttempts]);

  const retryAttempt = async (attempt: BillingChargeAttempt) => {
    setAttemptBusy(attempt.id);
    setAttemptNotice("");
    setAttemptExplanation(null);

    try {
      const outcome = await api.retryChargeAttempt(attempt.id, facilityId);

      setAttemptNotice(
        outcome.status === "BILLED"
          ? `Billed ${outcome.result.tariffCode ?? "tariff"} at ${
              outcome.result.unitPrice ?? 0
            }${outcome.result.unit ? ` / ${outcome.result.unit}` : ""} on invoice ${
              outcome.result.invoiceNumber ?? "—"
            }.`
          : outcome.result.message ??
            "Still waiting for a tariff. Nothing was billed.",
      );

      await loadAttempts();
      await loadTariffs();
    } catch (err) {
      setAttemptNotice(
        err instanceof Error ? err.message : "The retry did not complete.",
      );
    } finally {
      setAttemptBusy(null);
    }
  };

  const retryAllAttempts = async () => {
    setAttemptBusy("all");
    setAttemptNotice("");

    try {
      const summary = await api.retryChargeAttempts(facilityId);

      setAttemptNotice(
        `${summary.tried} retried · ${summary.billed} billed · ${summary.stillPending} still waiting for a tariff.`,
      );

      await loadAttempts();
      await loadTariffs();
    } catch (err) {
      setAttemptNotice(
        err instanceof Error ? err.message : "The retry did not complete.",
      );
    } finally {
      setAttemptBusy(null);
    }
  };

  const voidAttempt = async (attempt: BillingChargeAttempt) => {
    setAttemptBusy(attempt.id);
    setAttemptNotice("");

    try {
      await api.voidChargeAttempt(
        attempt.id,
        facilityId,
        "Written off from the tariff screen.",
      );
      setAttemptNotice("Written off. The record is kept.");
      await loadAttempts();
    } catch (err) {
      setAttemptNotice(
        err instanceof Error ? err.message : "The write-off did not complete.",
      );
    } finally {
      setAttemptBusy(null);
    }
  };

  /*
   * "Why was this not billed?" answered from the facility's own tariff
   * rows: the server returns every row with a verdict, so the answer
   * names OPD-001 rather than a code the facility has never typed.
   */
  const explainAttempt = async (attempt: BillingChargeAttempt) => {
    setAttemptBusy(attempt.id);
    setAttemptNotice("");

    try {
      const explanation = await api.explainTariffMatch({
        family: attempt.family ?? "CONSULTATION",
        ...(attempt.serviceName ? { name: attempt.serviceName } : {}),
        ...(attempt.encounterType
          ? { encounterType: attempt.encounterType }
          : {}),
        facilityId,
      });

      if (explanation.wouldBill) {
        setAttemptExplanation({
          id: attempt.id,
          text: `It would bill now: ${explanation.wouldBill.code} — ${explanation.wouldBill.description}, ${explanation.wouldBill.fee} / ${explanation.wouldBill.unit} (${explanation.wouldBill.rule.toLowerCase()}).`,
        });
      } else if (explanation.outcome.ambiguity) {
        setAttemptExplanation({
          id: attempt.id,
          text: `Two tariffs describe this service: ${explanation.outcome.ambiguity.codes.join(" and ")}. Link the right one under "Used for automatic billing".`,
        });
      } else {
        const nearMisses = explanation.rows
          .filter((row) => row.verdict !== "NO_MATCH")
          .slice(0, 4)
          .map((row) => `${row.code} (${row.verdict.toLowerCase().replace(/_/g, " ")})`);

        setAttemptExplanation({
          id: attempt.id,
          text: nearMisses.length
            ? `No tariff prices this yet. Closest rows: ${nearMisses.join(", ")}.`
            : `No tariff in this facility describes this service. Codes tried: ${explanation.codes.join(", ")}.`,
        });
      }
    } catch (err) {
      setAttemptExplanation({
        id: attempt.id,
        text:
          err instanceof Error
            ? err.message
            : "The explanation could not be fetched.",
      });
    } finally {
      setAttemptBusy(null);
    }
  };

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

  /* Wards, best effort: a refusal hides the picker, not the screen. */
  useEffect(() => {
    let cancelled = false;

    api
      .getWards(facilityId)
      .then((rows) => {
        if (!cancelled) setWards(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setWards([]);
      });

    return () => {
      cancelled = true;
    };
  }, [facilityId]);

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
      effectiveFrom: (tariff.effectiveFrom ?? "").slice(0, 10),
      effectiveTo: (tariff.effectiveTo ?? "").slice(0, 10),
      autoBill: tariff.autoBill !== false,
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
        effectiveFrom: form.effectiveFrom.trim() || null,
        effectiveTo: form.effectiveTo.trim() || null,
        autoBill: form.autoBill,
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
                  <span className="text-right">
                    <span className="font-mono text-emerald-700">
                      {entry.match.code} · {entry.match.fee}
                      {entry.match.unit ? ` / ${entry.match.unit}` : ""}
                    </span>
                    <span className="ml-1 text-2xs text-slate-400">
                      {entry.rule === "LINK"
                        ? "linked"
                        : entry.rule === "CODE"
                          ? "by code"
                          : "by description"}
                    </span>
                  </span>
                ) : entry.ambiguity ? (
                  <span
                    className="text-amber-700"
                    title={`${entry.ambiguity.codes.join(" and ")} both describe this service`}
                  >
                    two tariffs claim it
                  </span>
                ) : entry.specific.length > 0 ? (
                  <span className="text-slate-600">
                    {entry.specific.length} specific price
                    {entry.specific.length === 1 ? "" : "s"} only
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

      {/*
        Catalogue service → tariff links.

        The strongest statement a facility can make is "this catalogue
        row, by id, is priced by that tariff row". It cannot be broken by
        renaming a code, and it cannot be ambiguous.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Link a service to one of your tariffs
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Automatic billing finds a price by matching a code. When your codes are
          numbered — <span className="font-mono">LAB-001</span>,{" "}
          <span className="font-mono">OPD-001</span> — nothing can match, and the
          service is recorded without a charge. Link the catalogue row here and
          the price is certain, whatever the code is called.
        </p>

        {linksUnavailable !== "" ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {linksUnavailable}
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div>
                <label className={labelClass} htmlFor={`link-type-${facilityId}`}>
                  Service type
                </label>
                <select
                  id={`link-type-${facilityId}`}
                  className={fieldClass}
                  value={linkDraft.serviceType}
                  onChange={(event) =>
                    setLinkDraft((current) => ({
                      ...current,
                      serviceType: event.target.value,
                      testId: null,
                      wardId: null,
                    }))
                  }
                >
                  <option value="LAB_TEST">Laboratory test</option>
                  <option value="CONSULTATION">Consultation (all)</option>
                  <option value="RADIOLOGY">Radiology (all)</option>
                  <option value="PROCEDURE">Procedure (all)</option>
                  <option value="PHARMACY">Pharmacy (all)</option>
                  <option value="ADMISSION">Admission</option>
                  <option value="BED_DAY">Bed-day</option>
                  <option value="DELIVERY">Delivery</option>
                </select>
              </div>

              {linkDraft.serviceType === "LAB_TEST" && (
                <div>
                  <label className={labelClass} htmlFor={`link-test-${facilityId}`}>
                    Laboratory test
                  </label>
                  <select
                    id={`link-test-${facilityId}`}
                    className={fieldClass}
                    value={linkDraft.testId === null ? "" : String(linkDraft.testId)}
                    onChange={(event) =>
                      setLinkDraft((current) => ({
                        ...current,
                        testId: event.target.value === "" ? null : Number(event.target.value),
                      }))
                    }
                  >
                    <option value="">Choose a test…</option>
                    {labTests
                      .filter((test) => test.isActive !== false)
                      .map((test) => (
                        <option key={test.id} value={test.id}>
                          {test.code} — {test.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {linkDraft.serviceType === "BED_DAY" && (
                <div>
                  <label className={labelClass} htmlFor={`link-ward-${facilityId}`}>
                    Ward
                  </label>
                  <select
                    id={`link-ward-${facilityId}`}
                    className={fieldClass}
                    value={
                      linkDraft.wardId === null ? "" : String(linkDraft.wardId)
                    }
                    onChange={(event) =>
                      setLinkDraft((current) => ({
                        ...current,
                        wardId:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      }))
                    }
                  >
                    <option value="">Choose a ward…</option>
                    {wards
                      .filter((ward) => ward.isActive !== false)
                      .map((ward) => (
                        <option key={ward.id} value={ward.id}>
                          {ward.code} — {ward.name} ({ward.wardType ?? "General"})
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-2xs text-slate-500">
                    The link covers this ward&apos;s nights only. A general rate
                    never prices an ICU or maternity bed.
                  </p>
                </div>
              )}

              <div>
                <label className={labelClass} htmlFor={`link-tariff-${facilityId}`}>
                  Priced by
                </label>
                <select
                  id={`link-tariff-${facilityId}`}
                  className={fieldClass}
                  value={linkDraft.tariffId}
                  onChange={(event) =>
                    setLinkDraft((current) => ({ ...current, tariffId: event.target.value }))
                  }
                >
                  <option value="">Choose a tariff…</option>
                  {tariffs
                    .filter((tariff) => tariff.isActive)
                    .map((tariff) => (
                      <option key={tariff.id} value={tariff.id}>
                        {tariff.code} — {tariff.description} · {tariff.fee} / {tariff.unit}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={linkDraft.autoBill}
                    onChange={(event) =>
                      setLinkDraft((current) => ({
                        ...current,
                        autoBill: event.target.checked,
                      }))
                    }
                  />
                  Use automatically
                </label>
                <button
                  type="button"
                  onClick={() => void saveLink()}
                  disabled={linkBusy}
                  className="ml-auto rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {linkBusy ? "Saving…" : "Link"}
                </button>
              </div>
            </div>

            {linkNotice !== "" && (
              <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
                {linkNotice}
              </p>
            )}

            {links.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                No services are linked yet. Unlinked services still bill by code and
                by description; a link makes it certain.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {links.map((link) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-xs"
                  >
                    <span className="text-slate-700">
                      <span className="font-mono">
                        {link.serviceCode ?? link.serviceType}
                      </span>{" "}
                      {link.serviceName ?? "(all services of this type)"}
                      <span className="text-slate-400"> → </span>
                      <span className="font-mono text-emerald-700">
                        {link.tariffCode} · {link.tariffFee} / {link.tariffUnit}
                      </span>
                    </span>

                    <span className="flex items-center gap-2">
                      {!link.tariffActive && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800">
                          tariff inactive
                        </span>
                      )}
                      {!link.tariffAutoBill && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold text-amber-800">
                          manual only
                        </span>
                      )}
                      {!link.autoBill && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-slate-600">
                          link off
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeLink(link)}
                        disabled={linkBusy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-2xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Retire
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/*
        Laboratory diagnostics: every test in this facility, and what it
        would bill today. Runs the resolver the charger runs, so a green
        row here is a price on the next order.
      */}
      {enabledModules.includes("laboratory") && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                What each laboratory test would bill
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                The same resolution the server performs when a clinician orders the
                test. A test with no price is shown with the reason.
              </p>
            </div>
            {diagnostics && (
              <span
                className={
                  diagnostics.unresolvable > 0
                    ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                    : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                }
              >
                {diagnostics.resolved} of {diagnostics.total} priced
              </span>
            )}
          </div>

          {diagnosticsUnavailable !== "" && (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {diagnosticsUnavailable}
            </p>
          )}

          {diagnostics && diagnostics.tests.length === 0 && (
            <p className="mt-3 text-xs text-slate-500">
              This facility&apos;s laboratory catalogue is empty. Add tests under the
              Laboratory module first.
            </p>
          )}

          {diagnostics && diagnostics.tests.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Test</th>
                    <th className="py-1 pr-3 font-medium">Catalogue price</th>
                    <th className="py-1 pr-3 font-medium">Would bill</th>
                    <th className="py-1 font-medium">How / why not</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {diagnostics.tests.map((test) => (
                    <tr key={test.testId}>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono text-slate-700">{test.code}</span>{" "}
                        <span className="text-slate-600">{test.name}</span>
                        {!test.isActive && (
                          <span className="ml-1 text-2xs text-slate-400">(inactive)</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-400">
                        {test.cataloguePrice ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3">
                        {test.resolved ? (
                          <span className="font-mono text-emerald-700">
                            {test.resolved.code} · {test.resolved.fee} / {test.resolved.unit}
                          </span>
                        ) : (
                          <span className="text-amber-700">nothing</span>
                        )}
                      </td>
                      <td className="py-1.5 text-slate-500">
                        {test.resolved ? (
                          <span>
                            {test.resolved.rule === "LINK"
                              ? "linked to this test"
                              : test.resolved.rule === "FAMILY_LINK"
                                ? "linked to all tests"
                                : test.resolved.rule === "ALIAS"
                                  ? "approved alias"
                                  : test.resolved.rule === "CODE"
                                    ? `by code ${test.resolved.code}`
                                    : "by description"}
                          </span>
                        ) : (
                          <span title={test.failure?.message}>
                            {test.failure?.label ?? "no tariff"}
                            {test.failure?.candidates && test.failure.candidates.length > 0
                              ? ` — ${test.failure.candidates.join(" / ")}`
                              : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/*
        Unbilled charges.

        A visit whose tariff was missing is recorded but produces no
        invoice line. Before this list existed the skip was shown once
        and forgotten. Retrying runs the ordinary charge path, so a
        charge that was billed in the meantime is reported as a
        duplicate rather than billed twice.
      */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Charges that could not be priced
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Recorded on the clinical record, but no invoice line exists, so
              nothing has been claimed for them. Fix the price list, then retry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                (attempts?.pending ?? 0) > 0
                  ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                  : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
              }
            >
              {attempts === null
                ? "unavailable"
                : `${attempts.pending} waiting`}
            </span>
            <button
              type="button"
              onClick={() => void retryAllAttempts()}
              disabled={attemptBusy !== null || (attempts?.pending ?? 0) === 0}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {attemptBusy === "all" ? "Retrying…" : "Retry all"}
            </button>
          </div>
        </div>

        {attemptsUnavailable !== "" && (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {attemptsUnavailable}
          </p>
        )}

        {attemptNotice !== "" && (
          <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
            {attemptNotice}
          </p>
        )}

        {attempts !== null && attempts.attempts.length === 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Nothing is waiting. Every charge this facility attempted has an
            invoice line.
          </p>
        )}

        {attempts !== null && attempts.attempts.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {attempts.attempts.slice(0, 12).map((attempt) => (
              <li key={attempt.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {attempt.description ?? attempt.itemType}
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-normal text-slate-500">
                        {attempt.status.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {attempt.itemType} · patient #{attempt.patientId} · tried{" "}
                      {attempt.attempts} time{attempt.attempts === 1 ? "" : "s"}
                      {attempt.lastAttemptAt
                        ? ` · last ${new Date(attempt.lastAttemptAt).toLocaleString("en-KE")}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void explainAttempt(attempt)}
                      disabled={attemptBusy !== null}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-2xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Why?
                    </button>
                    <button
                      type="button"
                      onClick={() => void retryAttempt(attempt)}
                      disabled={attemptBusy !== null || attempt.status !== "PENDING"}
                      className="rounded-lg bg-blue-600 px-2 py-1 text-2xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {attemptBusy === attempt.id ? "Working…" : "Retry"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void voidAttempt(attempt)}
                      disabled={attemptBusy !== null || attempt.status !== "PENDING"}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-2xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Write off
                    </button>
                  </div>
                </div>

                {attempt.detail && (
                  <p className="mt-1 text-xs text-slate-500">{attempt.detail}</p>
                )}

                {attempt.codesTried.length > 0 && (
                  <p className="mt-1 font-mono text-2xs text-slate-400">
                    codes tried: {attempt.codesTried.join(", ")}
                  </p>
                )}

                {attemptExplanation?.id === attempt.id && (
                  <p className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-700">
                    {attemptExplanation.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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

          {/*
            Validity and the automatic-billing switch (migration 0021).

            A price list that changes on 1 January needs dates, not a
            rewrite: the resolver checks today against this pair and
            reports "expired" rather than silently charging an old rate.
          */}
          <div className="md:col-span-2 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor={`tariff-from-${facilityId}`}>
                Price valid from
              </label>
              <input
                id={`tariff-from-${facilityId}`}
                type="date"
                className={fieldClass}
                value={form.effectiveFrom}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    effectiveFrom: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className={labelClass} htmlFor={`tariff-to-${facilityId}`}>
                Price valid to
              </label>
              <input
                id={`tariff-to-${facilityId}`}
                type="date"
                className={fieldClass}
                value={form.effectiveTo}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    effectiveTo: event.target.value,
                  }))
                }
              />
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={form.autoBill}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      autoBill: event.target.checked,
                    }))
                  }
                />
                Use for automatic billing
              </label>
            </div>

            <p className="md:col-span-3 text-2xs leading-relaxed text-slate-500">
              Leave the dates empty for a price that never expires. Turn off
              automatic billing when a tariff should only be chosen by hand on an
              invoice — it stays available, it is simply not picked automatically.
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
