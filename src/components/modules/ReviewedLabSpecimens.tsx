import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';

type Source = { id: number; code: string; name: string };
type Option = {
  id: number;
  testId: number;
  specimenType: string;
  reviewReference: string;
  retiredAt: string | null;
  retirementReference: string | null;
};

/** Records an externally approved clinical rule, never inferred from a legacy default. */
export const ReviewedLabSpecimens: React.FC<{
  facilityId: number;
  sources: Source[];
  canManage: boolean;
}> = ({ facilityId, sources, canManage }) => {
  const [rows, setRows] = useState<Option[]>([]);
  const [testId, setTestId] = useState('');
  const [specimen, setSpecimen] = useState('');
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setError('');
    api
      .getReviewedLabSpecimens(facilityId)
      .then((value) => {
        if (current) setRows(value);
      })
      .catch(() => {
        if (current) {
          setRows([]);
          setError('Reviewed specimen settings could not be loaded.');
        }
      });
    return () => {
      current = false;
    };
  }, [facilityId, reload]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The review change could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 pt-3 text-xs">
      <p>
        Record specimen choices only after facility clinical review. Enter one specimen per option;
        the old default is not evidence of a valid specimen. A review reference is required for
        every change.
      </p>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Test for reviewed specimen"
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
          className="rounded border p-2"
        >
          <option value="">Select an active test</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.code} — {source.name}
            </option>
          ))}
        </select>
        <input
          aria-label="One reviewed specimen"
          value={specimen}
          onChange={(e) => setSpecimen(e.target.value)}
          placeholder="One specimen, e.g. as reviewed"
          className="rounded border p-2"
        />
        <input
          aria-label="Clinical specimen review reference"
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="Clinical review reference"
          className="rounded border p-2"
        />
        <button
          type="button"
          className="rounded border border-teal-700 px-3 py-2 disabled:opacity-40"
          disabled={!canManage || busy || !testId || !specimen.trim() || review.trim().length < 3}
          onClick={() =>
            void run(async () => {
              await api.addReviewedLabSpecimen(facilityId, Number(testId), specimen, review);
              setSpecimen('');
            }, 'Reviewed specimen recorded and audited.')
          }
        >
          Add reviewed specimen
        </button>
      </div>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="py-2">
            {sources.find((source) => source.id === row.testId)?.name ?? `Test #${row.testId}`} ·{' '}
            {row.specimenType} · {row.retiredAt ? 'Retired' : 'Active'} · review:{' '}
            {row.reviewReference}
            {!row.retiredAt && (
              <button
                type="button"
                className="ml-3 text-rose-700 disabled:opacity-40"
                disabled={!canManage || busy || review.trim().length < 3}
                onClick={() =>
                  void run(
                    () => api.retireReviewedLabSpecimen(facilityId, row.id, review),
                    'Specimen option retired and audited.',
                  )
                }
              >
                Retire with review reference
              </button>
            )}
          </li>
        ))}
      </ul>
      {!rows.length && !error && <p>No reviewed specimen options recorded.</p>}
    </div>
  );
};
