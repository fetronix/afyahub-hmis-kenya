import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { AnalyticsSummary, PublicHealthReport, QueueItem } from '../../types/index.ts';
import {
  Users,
  BedDouble,
  Activity,
  DollarSign,
  FlaskConical,
  Scissors,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  Calendar,
  Building2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

export const DashboardModule: React.FC = () => {
  const { currentFacility, setActiveModule, setSelectedPatient, setIsJourneyModalOpen, refreshKey, showToast } = useHmis();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [surveillance, setSurveillance] = useState<PublicHealthReport[]>([]);
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const [sum, rep, q] = await Promise.all([
          api.getAnalyticsSummary(currentFacility?.id),
          api.getPublicHealthReports(currentFacility?.id),
          api.getQueues(currentFacility?.id),
        ]);
        setSummary(sum);
        setSurveillance(rep);
        setQueues(q);
      } catch (err) {
        console.error('Failed to load dashboard metrics:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, [currentFacility, refreshKey]);

  return (
    <div className="space-y-6">
      {/* Top Banner with Facility & Compliance Status */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              {currentFacility?.name || 'JaliCare Kenya Facility'}
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 bg-blue-50 text-blue-900 rounded font-bold border border-blue-200/80">
              {currentFacility?.mflCode || 'MFL-12845'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {currentFacility?.level} · {currentFacility?.county} County · Master Facility Registry Synchronized
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
          <button
            onClick={() => setActiveModule('registration')}
            className="flex-1 md:flex-none px-4 py-2 text-xs font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 active:bg-orange-800 transition-colors shadow-xs flex items-center justify-center gap-1.5"
          >
            <span>+ Register Patient</span>
          </button>
          <button
            onClick={() => setActiveModule('reception')}
            className="flex-1 md:flex-none px-3.5 py-2 text-xs font-semibold text-blue-900 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
          >
            Queue Board
          </button>
          <button
            onClick={() => setActiveModule('interoperability')}
            className="px-3.5 py-2 text-xs font-semibold text-blue-900 bg-blue-50/70 border border-blue-200 hover:bg-blue-100/70 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
            <span>DHA Spec</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Outpatient Activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-2xs font-semibold tracking-wider uppercase text-slate-500">Active Queues</span>
            <Users className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {summary?.activeQueuesCount ?? 0}
            </span>
            <span className="text-2xs text-slate-500">Patients waiting</span>
          </div>
          <div className="mt-2 text-2xs text-slate-500 flex items-center gap-1">
            <span>Avg triage wait: </span>
            <strong className="font-mono text-blue-900">12 mins</strong>
          </div>
        </div>

        {/* Card 2: Inpatient Occupancy */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-2xs font-semibold tracking-wider uppercase text-slate-500">Bed Occupancy</span>
            <BedDouble className="w-4 h-4 text-orange-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {summary?.bedOccupancyRate ?? 0}%
            </span>
            <span className="text-2xs text-slate-500">{summary?.currentAdmissions ?? 0} Admitted</span>
          </div>
          <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-orange-500 h-1.5 rounded-full"
              style={{ width: `${Math.min(100, summary?.bedOccupancyRate ?? 0)}%` }}
            />
          </div>
        </div>

        {/* Card 3: Revenue Today */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-2xs font-semibold tracking-wider uppercase text-slate-500">Collections (KES)</span>
            <DollarSign className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              KES {summary ? Number(summary.totalRevenueKes).toLocaleString() : '0'}
            </span>
          </div>
          <div className="mt-2 text-2xs text-orange-800 flex items-center justify-between">
            <span>Outstanding:</span>
            <strong className="font-mono">KES {summary ? Number(summary.outstandingBillsKes).toLocaleString() : '0'}</strong>
          </div>
        </div>

        {/* Card 4: Clinical Diagnostics & OT */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-2xs font-semibold tracking-wider uppercase text-slate-500">Theatre & Lab</span>
            <Activity className="w-4 h-4 text-blue-700" />
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div>
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">{summary?.scheduledSurgeries ?? 0}</span>
              <span className="text-2xs text-slate-500 ml-1">Surgeries</span>
            </div>
            <span className="text-slate-300">·</span>
            <div>
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">{summary?.pendingLabOrders ?? 0}</span>
              <span className="text-2xs text-slate-500 ml-1">Pending Labs</span>
            </div>
          </div>
          <div className="mt-2 text-2xs text-slate-500">
            <span>Low drug stocks: </span>
            <strong className="font-mono text-rose-600">{summary?.lowStockAlerts ?? 0} items</strong>
          </div>
        </div>
      </div>

      {/* Main Grid: Real-Time Patient Queue & Disease Surveillance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Real-time OPD Queue Station (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-700" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Active Hospital Patient Queues
              </h2>
            </div>
            <button
              onClick={() => setActiveModule('reception')}
              className="text-xs text-blue-700 font-semibold hover:text-blue-900 flex items-center gap-1"
            >
              <span>Manage All Queues</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Token #</th>
                  <th className="px-4 py-2.5 font-medium">Queue Station</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Wait Time</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {queues.slice(0, 5).map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-slate-900">{q.tokenNumber}</td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <span className="font-medium">{q.queueType} Counter</span>
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                        q.priority === 'Emergency'
                          ? 'bg-rose-50 text-rose-700'
                          : q.priority === 'Priority'
                          ? 'bg-orange-50 text-orange-800 border border-orange-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {q.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{q.waitingTimeMinutes} mins</td>
                    <td className="px-4 py-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                        q.status === 'In-Progress' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <button
                        onClick={() => {
                          api.getPatient(q.patientId).then(p => {
                            setSelectedPatient(p);
                            setIsJourneyModalOpen(true);
                          });
                        }}
                        className="px-2.5 py-1 text-2xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                      >
                        Patient Journey
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Public Health & Kenya Surveillance Card (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                MOH 705 Surveillance
              </h2>
            </div>
            <button
              onClick={() => setActiveModule('public_health')}
              className="text-xs text-blue-700 font-semibold hover:text-blue-900"
            >
              Full Report
            </button>
          </div>

          <div className="p-4 space-y-3 flex-1">
            <div className="text-2xs text-slate-500 font-medium">
              Epi-Week: <strong className="text-slate-800 font-mono">2026-W40</strong> · KHIS / DHIS2 Synchronized
            </div>

            <div className="space-y-2">
              {surveillance.map((rep) => (
                <div key={rep.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">{rep.diseaseName}</div>
                    <div className="text-2xs text-slate-500 font-mono">
                      ICD-10: {rep.diseaseCode} · Age: {rep.ageGroup}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-bold font-mono text-slate-900 tabular-nums">
                      {rep.casesCount}
                    </span>
                    <span className="text-2xs text-slate-400 block">cases</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 text-2xs text-slate-500 flex items-center justify-between">
              <span>Notifiable Disease Sentinel</span>
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Normal Threshold
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Kenya Digital Health Architecture Summary */}
      <div className="bg-slate-950 text-white rounded-xl p-5 shadow-sm border-l-4 border-orange-500">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-2xs font-mono font-semibold bg-orange-500/20 text-orange-300 rounded border border-orange-500/30">
                KENYA DIGITAL HEALTH ACT COMPLIANT
              </span>
              <span className="text-xs text-slate-400">Interoperability Readiness</span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              JaliCare Enterprise Healthcare Interoperability Core
            </h3>
            <p className="text-xs text-slate-300 mt-0.5 max-w-2xl leading-relaxed">
              Equipped with HL7 FHIR R4 schema transformations, Social Health Authority (SHA) tariff billing integration, ICD-10 diagnostic coding, and Kenya Master Facility List (KMFL) reporting standards.
            </p>
          </div>

          <button
            onClick={() => setActiveModule('interoperability')}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shadow-xs"
          >
            Review DHA Certification Matrix
          </button>
        </div>
      </div>
    </div>
  );
};
