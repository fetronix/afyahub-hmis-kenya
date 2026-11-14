import { useEffect, useRef } from 'react';
import { planningViews } from '../planning/PlanningWorkspace.tsx';

export type BudgetingView = (typeof planningViews)[number][0];
const prefix = '#accounting/';

/** Navigation-only bookmark: no tenant, facility, plan data or authorization comes from the URL. */
export function readBudgetingView(hash = window.location.hash): BudgetingView | null {
  if (!hash.startsWith(prefix)) return null;
  const view = hash.slice(prefix.length);
  return planningViews.some(([id]) => id === view) ? (view as BudgetingView) : null;
}

export function writeBudgetingView(view: string) {
  const next = planningViews.some(([id]) => id === view) ? prefix + view : '';
  if (!next && !readBudgetingView()) return;
  if (window.location.hash === next) return;
  window.history.pushState(null, '', window.location.pathname + window.location.search + next);
}

/** Enter only the existing accounting module; its authentication/facility/RBAC gates are unchanged. */
export function useBudgetingEntry(
  isAuthenticated: boolean,
  activeModule: string,
  setActiveModule: (module: 'accounting') => void,
) {
  const previousModule = useRef(activeModule);
  useEffect(() => {
    const restore = () => {
      if (isAuthenticated && readBudgetingView()) setActiveModule('accounting');
    };
    restore();
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('hashchange', restore);
      window.removeEventListener('popstate', restore);
    };
  }, [isAuthenticated, setActiveModule]);
  useEffect(() => {
    if (
      previousModule.current === 'accounting' &&
      activeModule !== 'accounting' &&
      readBudgetingView()
    ) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    previousModule.current = activeModule;
  }, [activeModule]);
}
