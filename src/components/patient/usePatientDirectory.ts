import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { Patient } from '../../types/index.ts';

type PageState = {
  requestKey: string;
  status: 'ready' | 'error';
  items: Patient[];
  nextCursor: number | null;
};

/**
 * Bounded, server-scoped patient browsing. State is tagged to the complete
 * scope/query/cursor so a delayed response cannot be displayed in a new one.
 */
export function usePatientDirectory(options: {
  tenantId?: number;
  facilityId?: number;
  search: string;
  refreshKey?: number;
}) {
  const { tenantId, facilityId, search, refreshKey = 0 } = options;
  const [navigation, setNavigation] = useState<{
    base: string;
    cursors: Array<number | undefined>;
    index: number;
  } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [pageState, setPageState] = useState<PageState | null>(null);
  const base = tenantId && facilityId ? JSON.stringify([tenantId, facilityId, search]) : null;
  const nav =
    navigation?.base === base ? navigation : { base: base ?? '', cursors: [undefined], index: 0 };
  const beforeId = nav.cursors[nav.index];
  const requestKey = JSON.stringify([base, beforeId ?? null, refreshKey, retryKey]);
  const current = pageState?.requestKey === requestKey ? pageState : null;

  useEffect(() => {
    if (!tenantId || !facilityId || !base) return;
    let active = true;
    const timer = window.setTimeout(
      async () => {
        try {
          const page = await api.getPatientDirectoryPage({
            tenantId,
            facilityId,
            search,
            beforeId,
          });
          if (!active) return;
          if (
            !Array.isArray(page.items) ||
            (page.nextCursor !== null &&
              (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0))
          ) {
            throw new Error('Invalid directory response');
          }
          setPageState({
            requestKey,
            status: 'ready',
            items: page.items,
            nextCursor: page.nextCursor,
          });
        } catch {
          if (active) setPageState({ requestKey, status: 'error', items: [], nextCursor: null });
        }
      },
      search.trim() ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tenantId, facilityId, search, beforeId, base, requestKey]);

  const error = !base
    ? 'Select an authorized facility to load the patient directory.'
    : current?.status === 'error'
      ? 'Patient directory could not be loaded. Do not assume no patients exist.'
      : '';
  const loading = !!base && !current;
  const ready = !!current && current.status === 'ready';
  const items = ready ? current.items : [];
  return {
    items,
    loading,
    error,
    ready,
    page: nav.index + 1,
    canPrevious: ready && nav.index > 0,
    canNext: ready && current.nextCursor !== null,
    previous: () => {
      if (ready && nav.index > 0) setNavigation({ ...nav, index: nav.index - 1 });
    },
    next: () => {
      if (!ready || current.nextCursor === null || !base) return;
      const cursors = nav.cursors.slice(0, nav.index + 1);
      cursors.push(current.nextCursor);
      setNavigation({ base, cursors, index: nav.index + 1 });
    },
    retry: () => setRetryKey((key) => key + 1),
  };
}
