// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../api/client.ts';
import { DashboardModule } from '../../components/modules/DashboardModule.tsx';

let context: any;
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => context }));

describe('expanded operational dashboard', () => {
  beforeEach(() => {
    context = {
      currentFacility: {
        id: 10,
        name: 'Synthetic Facility',
        enabledModules: [
          'analytics',
          'public_health',
          'reception',
          'inpatient',
          'inventory',
          'audit',
          'finance',
          'theatre',
          'laboratory',
        ],
        hiddenModules: [],
      },
      authenticatedUser: {
        fullName: 'Synthetic Clinician',
        permissions: [
          'reports.read',
          'appointments.read',
          'inpatient.read',
          'inventory.read',
          'audit.read',
          'billing.read',
          'laboratory.read',
          'clinical.read',
        ],
      },
      currentUser: { name: 'Synthetic Clinician', role: 'Clinician' },
      setActiveModule: vi.fn(),
      setSelectedPatient: vi.fn(),
      setIsJourneyModalOpen: vi.fn(),
      refreshKey: 0,
    };
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not fetch or expose facility modules that are hidden even with permission', async () => {
    context.currentFacility.hiddenModules = [...context.currentFacility.enabledModules];
    const summary = vi.spyOn(api, 'getAnalyticsSummary');
    const reports = vi.spyOn(api, 'getPublicHealthReports');
    const queues = vi.spyOn(api, 'getQueues');
    const board = vi.spyOn(api, 'getInpatientBoard');
    const inventory = vi.spyOn(api, 'getInventoryBatches');
    const audit = vi.spyOn(api, 'getAuditLogs');
    render(<DashboardModule />);
    await waitFor(() => expect(screen.queryByText('Refreshing')).not.toBeInTheDocument());
    for (const spy of [summary, reports, queues, board, inventory, audit])
      expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText('Work the queue')).not.toBeInTheDocument();
    expect(screen.queryByText('DHA readiness')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoice paid amounts · unreconciled')).not.toBeInTheDocument();
  });

  it('shows a failed queue request as unavailable, not an empty queue', async () => {
    vi.spyOn(api, 'getAnalyticsSummary').mockResolvedValue({
      activeQueuesCount: 0,
      currentAdmissions: 0,
      bedOccupancyRate: 0,
      scheduledSurgeries: 0,
      pendingLabOrders: 0,
      totalRevenueKes: 0,
      outstandingBillsKes: 0,
      lowStockAlerts: 0,
      expiringStockAlerts: 0,
      totalPatients: 0,
    });
    vi.spyOn(api, 'getPublicHealthReports').mockResolvedValue([]);
    vi.spyOn(api, 'getQueues').mockRejectedValue(new Error('Synthetic API error'));
    vi.spyOn(api, 'getInpatientBoard').mockResolvedValue({
      shift: 'Day',
      admissionCount: 0,
      occupancyRate: 0,
      vitalsOverdueCount: 0,
      criticalVitalsCount: 0,
      rows: [],
    } as any);
    vi.spyOn(api, 'getInventoryBatches').mockResolvedValue([]);
    vi.spyOn(api, 'getAuditLogs').mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<DashboardModule />);
    expect(await screen.findByText('Queue records are unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The patient queue could not be loaded.');
    expect(screen.queryByText(/No queue records to display/)).not.toBeInTheDocument();
  });
});
