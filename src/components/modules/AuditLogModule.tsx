import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { AuditLog } from '../../types/index.ts';
import {
  ShieldAlert,
  Search,
  Lock,
  Clock,
  UserCheck
} from 'lucide-react';

export const AuditLogModule: React.FC = () => {
  const { currentFacility, refreshKey } = useHmis();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLogs() {
      setLoading(true);
      try {
        const lList = await api.getAuditLogs(currentFacility?.id);
        setLogs(lList);
      } catch (err) {
        console.error('Failed to load audit logs:', err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, [currentFacility, refreshKey]);

  const filteredLogs = logs.filter(l =>
    l.action.toLowerCase().includes(search.toLowerCase()) ||
    l.resource.toLowerCase().includes(search.toLowerCase()) ||
    (l.details && l.details.toLowerCase().includes(search.toLowerCase())) ||
    (l.userId && l.userId.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Security Audit Trail & Compliance Ledger</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable transaction records under the Kenya Data Protection Act 2019 and Digital Health Agency security requirements.
          </p>
        </div>

        <span className="px-3 py-1.5 bg-slate-900 text-teal-400 font-mono text-2xs font-semibold rounded-lg flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span>Tamper-Resistant Log</span>
        </span>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, action, resource, details..."
              className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-700 bg-white"
            />
          </div>

          <span className="text-2xs font-mono text-slate-400">{filteredLogs.length} events logged</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Timestamp</th>
                <th className="px-4 py-2.5 font-medium">Staff User ID</th>
                <th className="px-4 py-2.5 font-medium">Security Action</th>
                <th className="px-4 py-2.5 font-medium">Resource</th>
                <th className="px-4 py-2.5 font-medium">Event Description & Parameters</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-2xs">
                    {new Date(log.timestamp).toLocaleString('en-KE')}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{log.userId || 'System'}</td>
                  <td className="px-4 py-3 font-sans">
                    <span className={`px-2 py-0.5 rounded text-2xs font-bold ${
                      log.action === 'CREATE'
                        ? 'bg-emerald-50 text-emerald-800'
                        : log.action === 'DELETE'
                        ? 'bg-rose-50 text-rose-800'
                        : 'bg-teal-50 text-teal-800'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 font-sans font-medium">
                    {log.resource} {log.resourceId ? `#${log.resourceId}` : ''}
                  </td>
                  <td className="px-4 py-3 font-sans text-slate-700 text-xs max-w-md truncate">
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
