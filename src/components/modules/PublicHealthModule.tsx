import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { PublicHealthReport } from '../../types/index.ts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Download,
  Calendar,
  ShieldAlert,
  BarChart3
} from 'lucide-react';

export const PublicHealthModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const [reports, setReports] = useState<PublicHealthReport[]>([]);
  const [mohSummary, setMohSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // New Sentinel Alert Modal
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({
    diseaseCode: 'A00',
    diseaseName: 'Cholera (Suspected/Alert)',
    casesCount: 1,
    mortalityCount: 0,
    ageGroup: 'Over 5 Years',
    epiWeek: '2026-W40',
  });

  useEffect(() => {
    async function loadPublicHealth() {
      setLoading(true);
      try {
        const [reps, summary] = await Promise.all([
          api.getPublicHealthReports(currentFacility?.id),
          api.getMoh705Summary(currentFacility?.id),
        ]);
        setReports(reps);
        setMohSummary(summary);
      } catch (err) {
        console.error('Failed to load public health surveillance:', err);
      } finally {
        setLoading(false);
      }
    }
    loadPublicHealth();
  }, [currentFacility, refreshKey]);

  const handleRecordAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.recordPublicHealthReport({
        facilityId: currentFacility?.id || 1,
        diseaseCode: alertForm.diseaseCode,
        diseaseName: alertForm.diseaseName,
        casesCount: Number(alertForm.casesCount),
        mortalityCount: Number(alertForm.mortalityCount),
        ageGroup: alertForm.ageGroup,
        epiWeek: alertForm.epiWeek,
      });

      showToast('Public Health sentinel case logged and queued for KHIS submission.');
      setIsAlertModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const downloadMoh705 = () => {
    const dataStr = JSON.stringify(mohSummary, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MOH-705-Outpatient-Return-${currentFacility?.mflCode || 'MFL'}-2026-W40.json`;
    a.click();
    showToast('Downloaded Kenya MOH 705 Outpatient Return dataset.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Public Health Surveillance & MOH 705 Reporting</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Routine disease reporting (MOH 705A & 705B), notifiable epidemic alerts, and Kenya Health Information System (KHIS) export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={downloadMoh705}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-teal-700" />
            <span>Export MOH 705 JSON</span>
          </button>
          <button
            onClick={() => setIsAlertModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Report Sentinel Event</span>
          </button>
        </div>
      </div>

      {/* Sentinel Alert Banner */}
      <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-center justify-between text-xs text-amber-900 shadow-xs">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0" />
          <div>
            <span className="font-bold">Epi-Week Surveillance Active: 2026-W40</span>
            <p className="text-2xs text-amber-800 mt-0.5">
              Integrated with Kenya Digital Health Agency (DHA) national disease surveillance network. Immediate reporting mandated for suspected Cholera, Yellow Fever, Measles, and Viral Haemorrhagic Fevers.
            </p>
          </div>
        </div>

        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-semibold rounded text-2xs font-mono uppercase">
          Sentinel Monitoring
        </span>
      </div>

      {/* MOH 705 Top Morbidity Indicators Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-teal-700" />
            <span>Top Outpatient Morbidity (MOH 705 Summary)</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">Period: October 2026</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">ICD-10 Code</th>
                <th className="px-4 py-2.5 font-medium">Disease / Condition (MOH Description)</th>
                <th className="px-4 py-2.5 font-medium text-right">Under 5 Years</th>
                <th className="px-4 py-2.5 font-medium text-right">Over 5 Years</th>
                <th className="px-4 py-2.5 font-medium text-right">Total Cases</th>
                <th className="px-4 py-2.5 font-medium">Epidemic Threshold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {mohSummary?.indicators?.topMorbidityByIcd10?.map((row: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-teal-800">{row.code}</td>
                  <td className="px-4 py-3 font-sans font-semibold text-slate-900">{row.disease}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{row.under5}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{row.over5}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{row.total}</td>
                  <td className="px-4 py-3 font-sans">
                    <span className="px-2 py-0.5 rounded text-2xs bg-emerald-50 text-emerald-800 font-medium">
                      Normal Trend
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sentinel Event Surveillance Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-teal-700" />
            <span>Notifiable Epidemic Sentinel Log ({reports.length})</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">DHIS2 Auto-Push</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Disease Name</th>
                <th className="px-4 py-2.5 font-medium">ICD-10 Code</th>
                <th className="px-4 py-2.5 font-medium">Age Group</th>
                <th className="px-4 py-2.5 font-medium text-right">Cases</th>
                <th className="px-4 py-2.5 font-medium text-right">Mortality</th>
                <th className="px-4 py-2.5 font-medium">Epi-Week</th>
                <th className="px-4 py-2.5 font-medium text-right">Reported Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-sans font-semibold text-slate-900">{r.diseaseName}</td>
                  <td className="px-4 py-3 font-bold text-teal-800">{r.diseaseCode}</td>
                  <td className="px-4 py-3 font-sans text-slate-600">{r.ageGroup}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{r.casesCount}</td>
                  <td className="px-4 py-3 text-right text-rose-600">{r.mortalityCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.epiWeek}</td>
                  <td className="px-4 py-3 text-right text-slate-400 text-2xs">
                    {new Date(r.reportedAt).toLocaleString('en-KE')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* REPORT SENTINEL MODAL */}
      {isAlertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Log Public Health Sentinel Alert</h3>
              <p className="text-2xs text-slate-500">Record notifiable infectious condition for epidemic tracking.</p>
            </div>

            <form onSubmit={handleRecordAlert} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notifiable Disease Condition *</label>
                <select
                  value={alertForm.diseaseCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    const nameMap: Record<string, string> = {
                      'A00': 'Cholera (Suspected/Alert)',
                      'B05': 'Measles (Suspected)',
                      'B50': 'Malaria (Confirmed)',
                      'A20': 'Plague (Suspected)',
                      'A80': 'Acute Flaccid Paralysis (Polio Sentinel)',
                      'J09': 'Severe Acute Respiratory Infection (SARI)',
                    };
                    setAlertForm({
                      ...alertForm,
                      diseaseCode: code,
                      diseaseName: nameMap[code] || 'Notifiable Condition',
                    });
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="A00">A00 — Cholera (Suspected/Alert)</option>
                  <option value="B05">B05 — Measles (Suspected)</option>
                  <option value="B50">B50 — Malaria (Confirmed)</option>
                  <option value="A20">A20 — Plague (Suspected)</option>
                  <option value="A80">A80 — Acute Flaccid Paralysis (Polio)</option>
                  <option value="J09">J09 — Severe Acute Respiratory Infection (SARI)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Cases Count *</label>
                  <input
                    type="number"
                    required
                    value={alertForm.casesCount}
                    onChange={(e) => setAlertForm({ ...alertForm, casesCount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mortality Count</label>
                  <input
                    type="number"
                    value={alertForm.mortalityCount}
                    onChange={(e) => setAlertForm({ ...alertForm, mortalityCount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Age Stratification</label>
                  <select
                    value={alertForm.ageGroup}
                    onChange={(e) => setAlertForm({ ...alertForm, ageGroup: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Under 5 Years">Under 5 Years (MOH 705A)</option>
                    <option value="Over 5 Years">Over 5 Years (MOH 705B)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Epidemiological Week</label>
                  <input
                    type="text"
                    value={alertForm.epiWeek}
                    onChange={(e) => setAlertForm({ ...alertForm, epiWeek: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAlertModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-rose-700 text-white rounded-md font-semibold hover:bg-rose-800"
                >
                  Submit Sentinel Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
