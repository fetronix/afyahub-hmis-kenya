// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../App.tsx';
import { HmisProvider, useHmis } from '../../context/HmisContext.tsx';
import { SuperAdminDashboardModule } from '../../components/modules/SuperAdminDashboardModule.tsx';
import { api, ApiError, clearSessionToken, setSessionToken } from '../../api/client.ts';

function ContextInspector() {
  const {
    isAuthenticated,
    authLoading,
    contextLoading,
    contextError,
    tenants,
    currentTenant,
    facilities,
    currentFacility,
    retryContextInitialization,
  } = useHmis();

  return (
    <div>
      <span data-testid="auth-loading">{String(authLoading)}</span>
      <span data-testid="is-auth">{String(isAuthenticated)}</span>
      <span data-testid="ctx-loading">{String(contextLoading)}</span>
      <span data-testid="ctx-error-kind">{contextError?.kind ?? 'none'}</span>
      <span data-testid="ctx-error-msg">{contextError?.message ?? ''}</span>
      <span data-testid="tenant-count">{tenants.length}</span>
      <span data-testid="current-tenant">{currentTenant?.name ?? 'none'}</span>
      <span data-testid="facility-count">{facilities.length}</span>
      <span data-testid="current-facility">{currentFacility?.name ?? 'none'}</span>
      <button type="button" onClick={() => void retryContextInitialization()}>
        Retry Context
      </button>
    </div>
  );
}

describe('SuperAdminDashboardModule — genuine empty data vs failed API requests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders genuine zero counts when endpoints succeed with empty arrays', async () => {
    vi.spyOn(api, 'getTenants').mockResolvedValue([]);
    vi.spyOn(api, 'getFacilities').mockResolvedValue([]);
    vi.spyOn(api, 'getAuditLogs').mockResolvedValue([]);
    vi.spyOn(api, 'getSubscriptionPeriods').mockResolvedValue([]);
    vi.spyOn(api, 'getHealth').mockResolvedValue({
      status: 'healthy',
      system: 'JaliCare HMIS',
      dhaReadiness: 'Mock mode',
      timestamp: '2026-10-27T08:00:00.000Z',
    });

    render(<SuperAdminDashboardModule onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No audit records returned.')).toBeInTheDocument();
    });

    expect(screen.queryByText('Some dashboard data could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getByText('0 marked active')).toBeInTheDocument();

    const articles = screen.getAllByRole('article');
    expect(within(articles[0]!).getByText('0')).toBeInTheDocument();
    expect(within(articles[1]!).getByText('0')).toBeInTheDocument();
    expect(within(articles[2]!).getByText('0')).toBeInTheDocument();
    expect(within(articles[3]!).getByText('0')).toBeInTheDocument();
  });

  it('never displays failed API requests as zero and recovers cleanly when refreshed', async () => {
    const getTenantsSpy = vi
      .spyOn(api, 'getTenants')
      .mockRejectedValueOnce(
        new ApiError(
          'Expected JSON from /api/tenants, but received an HTML document (HTTP 200).',
          200,
          'UNEXPECTED_HTML_RESPONSE',
        ),
      )
      .mockResolvedValueOnce([{ id: 1, name: 'Nyeri County Health' } as any]);

    const getFacilitiesSpy = vi
      .spyOn(api, 'getFacilities')
      .mockRejectedValueOnce(new ApiError('Service unavailable', 503, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce([
        { id: 10, tenantId: 1, name: 'Nyeri Referral Hospital' } as any,
        { id: 11, tenantId: 1, name: 'Karatina Sub-County Hospital' } as any,
      ]);

    const getAuditSpy = vi
      .spyOn(api, 'getAuditLogs')
      .mockRejectedValueOnce(new ApiError('Audit unavailable', 503, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce([
        {
          id: 99,
          action: 'TENANT_VERIFIED',
          username: 'superadmin',
          createdAt: '2026-10-27T09:00:00Z',
        } as any,
      ]);

    vi.spyOn(api, 'getSubscriptionPeriods').mockResolvedValue([{ id: 1, status: 'ACTIVE' }]);
    vi.spyOn(api, 'getHealth').mockResolvedValue({
      status: 'healthy',
      system: 'JaliCare HMIS',
      dhaReadiness: 'Mock mode',
      timestamp: '2026-10-27T08:00:00.000Z',
    });

    const user = userEvent.setup();
    render(<SuperAdminDashboardModule onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Some dashboard data could not be loaded.')).toBeInTheDocument();
    });

    expect(screen.getByText('Audit activity could not be loaded.')).toBeInTheDocument();

    const articles = screen.getAllByRole('article');
    /* Failed Tenants, Facilities, and Audit cards show em-dash, never 0. */
    expect(within(articles[0]!).getByText('—')).toBeInTheDocument();
    expect(within(articles[1]!).getByText('—')).toBeInTheDocument();
    /* Subscriptions succeeded with 1 active record. */
    expect(within(articles[2]!).getByText('1')).toBeInTheDocument();
    expect(within(articles[3]!).getByText('—')).toBeInTheDocument();

    /* Recover when temporary error resolves and operator clicks Refresh data. */
    await user.click(screen.getByRole('button', { name: /refresh data/i }));

    await waitFor(() => {
      expect(
        screen.queryByText('Some dashboard data could not be loaded.'),
      ).not.toBeInTheDocument();
    });

    expect(getTenantsSpy).toHaveBeenCalledTimes(2);
    expect(getFacilitiesSpy).toHaveBeenCalledTimes(2);
    expect(getAuditSpy).toHaveBeenCalledTimes(2);
    expect(within(articles[0]!).getByText('1')).toBeInTheDocument();
    expect(within(articles[1]!).getByText('2')).toBeInTheDocument();
    expect(within(articles[3]!).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('TENANT_VERIFIED')).toBeInTheDocument();
  });
});

describe('HmisProvider & App — authorized tenant/facility context initialization', () => {
  beforeEach(() => {
    clearSessionToken();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    clearSessionToken();
    vi.restoreAllMocks();
  });

  it('prevents infinite retry loops on server errors and recovers on explicit retry', async () => {
    setSessionToken('b'.repeat(64));

    vi.spyOn(api, 'getSession').mockResolvedValue({
      success: true,
      user: {
        id: 5,
        uid: 'usr-5',
        username: 'nyeri.admin',
        email: 'admin@nyeri.test',
        fullName: 'Grace Wanjiku',
        tenantId: 1,
        facilityId: 10,
        roles: ['FACILITY_ADMIN'],
        permissions: ['patients.read'],
        isSuperAdmin: false,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      },
      session: {
        id: 1,
        expiresAt: '2026-10-28T00:00:00Z',
        lastActivityAt: '2026-10-27T09:00:00Z',
      },
    });

    const getTenantsSpy = vi
      .spyOn(api, 'getTenants')
      .mockRejectedValueOnce(new ApiError('Database unavailable', 503, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce([
        { id: 1, name: 'Nyeri County Health', slug: 'nyeri', isActive: true } as any,
      ]);

    const getFacilitiesSpy = vi.spyOn(api, 'getFacilities').mockResolvedValue([
      {
        id: 10,
        tenantId: 1,
        code: 'NYR-10',
        name: 'Nyeri County Referral Hospital',
        enabledModules: ['registration', 'opd'],
      } as any,
      /* Unauthorized sibling facility must never be selected for facility-bound user. */
      {
        id: 99,
        tenantId: 1,
        code: 'NYR-99',
        name: 'Other Facility',
        enabledModules: ['registration'],
      } as any,
    ]);

    const user = userEvent.setup();

    render(
      <HmisProvider>
        <ContextInspector />
      </HmisProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    /* Called once — no automatic retry loop. */
    expect(getTenantsSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('is-auth').textContent).toBe('true');
    expect(screen.getByTestId('ctx-error-kind').textContent).toBe('error');
    expect(screen.getByTestId('current-tenant').textContent).toBe('none');
    expect(screen.getByTestId('current-facility').textContent).toBe('none');

    /* Manual retry recovers and scopes strictly to facilityId=10. */
    await user.click(screen.getByRole('button', { name: 'Retry Context' }));

    await waitFor(() => {
      expect(screen.getByTestId('ctx-error-kind').textContent).toBe('none');
    });

    expect(getTenantsSpy).toHaveBeenCalledTimes(2);
    expect(getFacilitiesSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('current-tenant').textContent).toBe('Nyeri County Health');
    expect(screen.getByTestId('facility-count').textContent).toBe('1');
    expect(screen.getByTestId('current-facility').textContent).toBe(
      'Nyeri County Referral Hospital',
    );
  });

  it('refuses to initialize unauthorized tenants or facilities on 403 or mismatched scope', async () => {
    setSessionToken('c'.repeat(64));

    vi.spyOn(api, 'getSession').mockResolvedValue({
      success: true,
      user: {
        id: 7,
        uid: 'usr-7',
        username: 'staff.user',
        email: 'staff@nyeri.test',
        fullName: 'Peter Kamau',
        tenantId: 1,
        facilityId: 10,
        roles: ['CLINICIAN'],
        permissions: ['clinical.read'],
        isSuperAdmin: false,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      },
      session: {
        id: 2,
        expiresAt: '2026-10-28T00:00:00Z',
        lastActivityAt: '2026-10-27T09:00:00Z',
      },
    });

    /* Server returns only tenant 2 (not user's tenant 1) — must never select tenant 2. */
    vi.spyOn(api, 'getTenants').mockResolvedValue([
      { id: 2, name: 'Foreign Tenant', slug: 'foreign', isActive: true } as any,
    ]);
    const getFacilitiesSpy = vi.spyOn(api, 'getFacilities').mockResolvedValue([]);

    render(
      <HmisProvider>
        <ContextInspector />
      </HmisProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('ctx-error-kind').textContent).toBe('forbidden');
    expect(screen.getByTestId('tenant-count').textContent).toBe('0');
    expect(screen.getByTestId('current-tenant').textContent).toBe('none');
    expect(screen.getByTestId('current-facility').textContent).toBe('none');
    expect(getFacilitiesSpy).not.toHaveBeenCalled();
  });

  it('renders the redesigned LoginScreen when unauthenticated and transitions cleanly to the clinical Dashboard on sign-in', async () => {
    vi.spyOn(api, 'getSession')
      .mockRejectedValueOnce(new ApiError('Authentication is required.', 401, 'UNAUTHORIZED'))
      .mockResolvedValueOnce({
        success: true,
        user: {
          id: 9,
          uid: 'usr-9',
          username: 'dr.mwangi',
          email: 'mwangi@nyeri.test',
          fullName: 'Dr. Mwangi Kariuki',
          tenantId: 1,
          facilityId: 10,
          designation: 'Medical Officer',
          roles: ['DOCTOR'],
          permissions: ['patients.read', 'clinical.read'],
          isSuperAdmin: false,
          accountStatus: 'ACTIVE',
          mustChangePassword: false,
          mfaEnabled: false,
          mfaRequired: false,
        },
        session: {
          id: 9,
          expiresAt: '2026-10-28T00:00:00Z',
          lastActivityAt: '2026-10-27T09:00:00Z',
        },
      });

    vi.spyOn(api, 'login').mockResolvedValue({
      success: true,
      sessionToken: 'd'.repeat(64),
      user: {
        id: 9,
        uid: 'usr-9',
        username: 'dr.mwangi',
        email: 'mwangi@nyeri.test',
        fullName: 'Dr. Mwangi Kariuki',
        tenantId: 1,
        facilityId: 10,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      },
    });

    vi.spyOn(api, 'getTenants').mockResolvedValue([
      { id: 1, name: 'Nyeri County Health', slug: 'nyeri', isActive: true } as any,
    ]);
    vi.spyOn(api, 'getFacilities').mockResolvedValue([
      {
        id: 10,
        tenantId: 1,
        code: 'NYR-10',
        mflCode: '12345',
        name: 'Nyeri County Referral Hospital',
        enabledModules: ['registration', 'opd'],
      } as any,
    ]);
    vi.spyOn(api, 'getPatients').mockResolvedValue([]);
    vi.spyOn(api, 'getEncounters').mockResolvedValue([]);
    vi.spyOn(api, 'getLabOrders').mockResolvedValue([]);
    vi.spyOn(api, 'getInvoices').mockResolvedValue([]);
    vi.spyOn(api, 'getInventoryBatches').mockResolvedValue([]);
    vi.spyOn(api, 'getClaims').mockResolvedValue([]);

    const user = userEvent.setup();
    render(<App />);

    /* Redesigned login portal renders after initial unauthenticated session check. */
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { name: /Hospital Management\s+Information System/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/username or email/i), 'dr.mwangi');
    await user.type(screen.getByLabelText(/^password$/i), 'ValidPass#2026');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    /* Transitions to clinical dashboard with authorized facility context populated. */
    await waitFor(() => {
      expect(screen.getAllByText('Nyeri County Referral Hospital').length).toBeGreaterThanOrEqual(
        1,
      );
    });
    expect(screen.getAllByText(/MFL 12345/i).length).toBeGreaterThanOrEqual(1);
  });

  it('transitions back to LoginScreen if context initialization receives 401 Unauthorized', async () => {
    setSessionToken('e'.repeat(64));

    vi.spyOn(api, 'getSession').mockResolvedValue({
      success: true,
      user: {
        id: 11,
        uid: 'usr-11',
        username: 'expired.user',
        email: 'expired@nyeri.test',
        fullName: 'Expired User',
        tenantId: 1,
        facilityId: 10,
        roles: ['DOCTOR'],
        permissions: ['patients.read'],
        isSuperAdmin: false,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      },
      session: {
        id: 11,
        expiresAt: '2026-10-28T00:00:00Z',
        lastActivityAt: '2026-10-27T09:00:00Z',
      },
    });

    vi.spyOn(api, 'getTenants').mockRejectedValue(
      new ApiError(
        'Your session is invalid, expired, or has been revoked.',
        401,
        'INVALID_SESSION',
      ),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    });
  });
});
