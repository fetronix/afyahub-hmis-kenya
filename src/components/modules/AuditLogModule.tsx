import { DataTable, PageHeader } from '../ui/layout.tsx';
import { SearchBar } from '../ui/controls.tsx';
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { AuditLog } from '../../types/index.ts';
import { Lock } from 'lucide-react';

export const AuditLogModule: React.FC = () => {
  const { currentFacility, refreshKey } = useHmis();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadLogs() {
      setLoading(true);
      setError('');
      setLogs([]);
      try {
        const list = await api.getAuditLogs(currentFacility?.id);
        if (active) setLogs(list);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load audit events.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadLogs();
    return () => {
      active = false;
    };
  }, [currentFacility?.id, refreshKey, attempt]);

  const filteredLogs = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.resource.toLowerCase().includes(search.toLowerCase()) ||
      (l.details && l.details.toLowerCase().includes(search.toLowerCase())) ||
      (l.userId && l.userId.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Security Audit Trail</h1>
          <p className="ui-page-description">
            Review recorded security and activity events available to this account and facility.
          </p>
        </div>

        <span className="px-3 py-1.5 bg-slate-900 text-teal-400 font-mono text-2xs font-semibold rounded-lg flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span>Recorded events</span>
        </span>
      </PageHeader>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <SearchBar
            className="w-full max-w-md"
            aria-label="Search audit events"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search user, action, resource, details..."
          />

          <span className="text-2xs font-mono text-slate-400">
            {loading
              ? 'Loading events…'
              : error
                ? 'Events unavailable'
                : `${filteredLogs.length} events shown`}
          </span>
        </div>

        {error && (
          <div className="p-4">
            <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        )}
        {loading && (
          <div className="p-4">
            <LoadingSkeleton label="Loading audit events" />
          </div>
        )}
        {!loading && !error && filteredLogs.length === 0 && (
          <div className="p-4">
            <EmptyState
              title="No audit events found"
              description="Try a different search or check again later."
            />
          </div>
        )}
        {!loading && !error && filteredLogs.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-xs text-left">
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
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {log.userId || 'System'}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <StatusBadge
                        tone={
                          log.action === 'CREATE'
                            ? 'success'
                            : log.action === 'DELETE'
                              ? 'error'
                              : 'info'
                        }
                      >
                        {log.action}
                      </StatusBadge>
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
            </DataTable>
          </div>
        )}
      </div>
    </div>
  );
};
