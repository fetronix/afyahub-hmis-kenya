import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  documentRequest,
  type PortalDocument,
  type PortalDocumentPage,
  type PortalDocumentVersion,
} from '../../api/patient-documents.client.ts';

const GROUPS = [
  { id: 'ALL', label: 'All documents' },
  { id: 'CONSENT', label: 'Consent forms' },
  { id: 'CLINICAL', label: 'Clinical documents' },
  { id: 'OTHER', label: 'Other documents' },
] as const;

const EMPTY_MESSAGES: Record<string, { title: string; detail: string }> = {
  NONE_RELEASED: {
    title: 'No documents have been released to your portal yet.',
    detail:
      'Your facility decides which documents you can see here. Ask them to release a document if you expected to find one.',
  },
  AWAITING_RELEASE: {
    title: 'Your facility has documents awaiting release.',
    detail:
      'They will appear here once the facility releases them to your portal. The portal never shows a document before it is released.',
  },
  NO_MATCHES: {
    title: 'No documents match your current filters.',
    detail: 'Clear the search or category filter to see every released document again.',
  },
};

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'Not recorded';
}

/**
 * Patient-facing document list. Only documents the facility has explicitly
 * released to this patient are requested, and the server projects away staff
 * notes, release reasons, uploader identities and audit history.
 */
export function PortalDocuments() {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ search: '', group: 'ALL', from: '', to: '' });
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [meta, setMeta] = useState<PortalDocumentPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    url: string;
    mime: string;
    title: string;
    derived?: boolean;
  } | null>(null);
  const [history, setHistory] = useState<{
    documentId: number;
    title: string;
    versions: PortalDocumentVersion[];
  } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const requestKey = JSON.stringify([applied, cursor]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams({
      search: applied.search,
      group: applied.group,
      from: applied.from,
      to: applied.to,
      limit: '25',
    });
    if (cursor) query.set('cursor', cursor);
    documentRequest<PortalDocumentPage>(`?${query.toString()}`, {}, true)
      .then((page) => {
        if (!active) return;
        setMeta(page);
        setDocuments((current) =>
          cursor
            ? [...current, ...page.documents.filter((d) => !current.some((c) => c.id === d.id))]
            : page.documents,
        );
        setError('');
      })
      .catch((e: Error) => {
        if (!active) return;
        if (!cursor) setDocuments([]);
        setError(e.message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoadingMore(false);
      });
    return () => {
      active = false;
    };
    // `requestKey` covers every input of the request.
  }, [requestKey]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const emptyState = meta?.empty_state ?? (meta && meta.page.total === 0 ? 'NONE_RELEASED' : null);
  const sections = useMemo(() => {
    if (applied.group !== 'ALL')
      return [{ heading: GROUPS.find((g) => g.id === applied.group)?.label ?? '', documents }];
    return GROUPS.filter((g) => g.id !== 'ALL')
      .map((g) => ({
        heading: g.label,
        documents: documents.filter((d) => d.group === g.id),
      }))
      .filter((section) => section.documents.length > 0);
  }, [applied.group, documents]);
  async function retrieve(doc: PortalDocument, download: boolean) {
    setError('');
    try {
      const blob = await documentRequest<Blob>(
        `/${doc.id}/file${download ? '?download=1' : '?preview=1'}`,
        {},
        true,
      );
      if (download) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.title + (doc.mime_type === 'application/pdf' ? '.pdf' : '.jpg');
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else
        setPreview({
          url: URL.createObjectURL(blob),
          mime: doc.mime_type,
          title: doc.title,
          derived: (blob as Blob & { derivedPreview?: boolean }).derivedPreview,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document could not be opened.');
    }
  }
  async function showHistory(doc: PortalDocument) {
    setError('');
    try {
      const result = await documentRequest<{ versions: PortalDocumentVersion[] }>(
        `/${doc.id}/history`,
        {},
        true,
      );
      setHistory({ documentId: doc.id, title: doc.title, versions: result.versions });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Version history could not be loaded.');
    }
  }
  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setCursor(null);
    setDocuments([]);
    setApplied({ search: search.trim(), group, from, to });
  }
  function clearFilters() {
    setSearch('');
    setGroup('ALL');
    setFrom('');
    setTo('');
    setCursor(null);
    setDocuments([]);
    setApplied({ search: '', group: 'ALL', from: '', to: '' });
    searchInput.current?.focus();
  }
  const field = 'rounded border border-slate-300 p-2 text-sm w-full';
  const action =
    'rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50';
  return (
    <section aria-label="My Documents & Signed Consents" className="space-y-4 rounded border bg-white p-4">
      <div>
        <h3 className="text-lg font-bold">My Documents &amp; Signed Consents</h3>
        <p className="text-sm text-slate-600">
          These are documents your facility has released to your portal. Uploading a document is not
          a signature, and a released document is not verification of one.
        </p>
      </div>
      <form onSubmit={applyFilters} className="grid gap-2 sm:grid-cols-4" aria-label="Document filters">
        <label>
          Search my documents
          <input
            ref={searchInput}
            className={field}
            value={search}
            maxLength={80}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Document category
          <select className={field} value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {meta ? ` (${meta.groups[entry.id as keyof typeof meta.groups] ?? 0})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Upload date from
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Upload date to
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-4">
          <button className={action} type="submit">
            Search documents
          </button>
          <button className={action} type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {meta && meta.downloads_enabled === false && (
        <p className="text-sm text-amber-800">
          Your facility has turned off downloads. You can still view released documents here.
        </p>
      )}
      {loading && <p role="status">Loading your released documents…</p>}
      {!loading && emptyState && EMPTY_MESSAGES[emptyState] && (
        <div role="status" className="rounded bg-slate-50 p-4">
          <p className="font-semibold">{EMPTY_MESSAGES[emptyState].title}</p>
          <p className="text-sm text-slate-600">{EMPTY_MESSAGES[emptyState].detail}</p>
        </div>
      )}
      {!loading &&
        sections.map((section) => (
          <section key={section.heading} aria-label={section.heading} className="space-y-3">
            <h4 className="text-base font-semibold">{section.heading}</h4>
            {section.documents.length === 0 ? (
              <p className="text-sm text-slate-500">No released documents in this category.</p>
            ) : (
              <ul className="space-y-3">
                {section.documents.map((doc) => (
                  <li
                    key={doc.id}
                    data-patient-document={doc.id}
                    className="rounded border p-3 break-words"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{doc.title}</strong>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{doc.kind}</span>
                      {doc.is_superseded && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs">
                          Superseded by a newer version
                        </span>
                      )}
                    </div>
                    <p className="text-sm">
                      Document type: {doc.document_type} · Version {doc.version}
                    </p>
                    <p className="text-sm">
                      Signing date: {formatDate(doc.signing_date)} · Uploaded:{' '}
                      {new Date(doc.uploaded_at).toLocaleString()}
                    </p>
                    <p className="text-sm">
                      Source: {doc.source}
                      {doc.procedure_name ? ` · Imaging procedure: ${doc.procedure_name}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className={action} onClick={() => void retrieve(doc, false)}>
                        View document {doc.id}
                      </button>
                      <button
                        className={action}
                        disabled={meta?.downloads_enabled === false}
                        onClick={() => void retrieve(doc, true)}
                      >
                        Download original {doc.id}
                      </button>
                      {doc.has_versions && (
                        <button className={action} onClick={() => void showHistory(doc)}>
                          Version history {doc.id}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      {meta && meta.page.total > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Showing {documents.length} of {meta.page.total} released document versions.
          </p>
          <button
            className={action}
            disabled={loadingMore || !meta.page.has_more}
            onClick={() => {
              if (!meta.page.next_cursor) return;
              setLoadingMore(true);
              setCursor(meta.page.next_cursor);
            }}
          >
            {meta.page.has_more ? 'Load more documents' : 'All released documents loaded'}
          </button>
        </div>
      )}
      {history && (
        <section aria-label="Document version history" className="rounded border p-3">
          <h4 className="font-semibold">
            {history.title} · released versions
          </h4>
          {history.versions.map((version) => (
            <p key={version.id}>
              Version {version.version} · Uploaded {new Date(version.uploaded_at).toLocaleString()}
              {version.current ? ' · Opened above' : ''}
            </p>
          ))}
          <button className={action} onClick={() => setHistory(null)}>
            Close version history
          </button>
        </section>
      )}
      {preview && (
        <section aria-label="Document preview">
          <h4>{preview.title}</h4>
          <button className={action} onClick={() => setPreview(null)}>
            Close preview
          </button>
          {preview.mime === 'application/pdf' ? (
            <>
              <p className="text-xs text-slate-600">
                {preview.derived
                  ? 'Derived static preview: navigation actions have been removed. This copy is not the original signed document.'
                  : 'Preview of the unchanged uploaded original.'}{' '}
                Neither preview proves signature authenticity. Use Download original for the
                unchanged file.
              </p>
              <iframe
                title="Released document preview"
                src={preview.url}
                className="h-96 w-full"
                sandbox=""
                referrerPolicy="no-referrer"
              />
            </>
          ) : (
            <img alt={preview.title} src={preview.url} className="max-h-96 max-w-full object-contain" />
          )}
        </section>
      )}
    </section>
  );
}
