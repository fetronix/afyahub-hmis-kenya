// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    previewFacilityCatalogueImport: vi.fn(),
    importFacilityCatalogue: vi.fn(),
    getFacilityCatalogueImportStatus: vi.fn(),
    exportFacilityCatalogue: vi.fn(),
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
import { FacilityCatalogueTransfer } from '../../components/modules/FacilityCatalogueTransfer.tsx';

const normalized = {
  code: 'SYN-CONSULT',
  name: 'Synthetic consultation',
  description: 'Synthetic reviewed service',
  department: 'opd',
  category: 'CONSULTATION',
  unit: 'Visit',
  isActive: true,
  autoBill: true,
  initialPrice: '125.50',
  initialTariffCode: 'SYN-PRICE',
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
};
const result = {
  idempotentReplay: false,
  batchId: 21,
  rowCount: 1,
  services: [{ serviceId: 11, tariffId: 12, serviceCode: 'SYN-CONSULT', tariffCode: 'SYN-PRICE' }],
};
const setup = (canManage = true) => {
  const onImported = vi.fn(),
    onClose = vi.fn();
  render(
    <FacilityCatalogueTransfer
      facilityId={5}
      canManage={canManage}
      onImported={onImported}
      onClose={onClose}
    />,
  );
  return { onImported, onClose };
};
async function prepare() {
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
    target: { value: JSON.stringify([normalized]) },
  });
  await user.click(screen.getByRole('button', { name: 'Validate batch' }));
  await screen.findByRole('table', { name: 'Import review' });
  await user.type(
    screen.getByLabelText('Documented facility approval reference'),
    'Synthetic approval',
  );
  await user.click(screen.getByLabelText(/I reviewed all rows/));
  await user.click(screen.getByRole('button', { name: 'Prepare approved batch' }));
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.previewFacilityCatalogueImport.mockResolvedValue({
    valid: true,
    rowCount: 1,
    rows: [normalized],
    issues: [],
  });
  mocks.api.importFacilityCatalogue.mockResolvedValue(result);
  mocks.api.getFacilityCatalogueImportStatus.mockResolvedValue({ status: 'NOT_FOUND' });
  mocks.api.exportFacilityCatalogue.mockResolvedValue({
    filename: 'synthetic.csv',
    contentType: 'text/csv; charset=utf-8',
    base64: btoa('synthetic'),
    rowCount: 1,
    coverage: 'FACILITY_SERVICES_AND_LINKED_TARIFFS',
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Facility catalogue transfer (mocked browser API)', () => {
  it('shows validation issues and never imports an invalid batch', async () => {
    mocks.api.previewFacilityCatalogueImport.mockResolvedValue({
      valid: false,
      rowCount: 1,
      rows: [],
      issues: [{ row: 1, reasons: ['CATEGORY_DEPARTMENT_MISMATCH'] }],
    });
    setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    const issues = await screen.findByLabelText('Import validation issues');
    expect(within(issues).getByText(/Row 1: The category does not match/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Prepare approved batch' }),
    ).not.toBeInTheDocument();
    expect(mocks.api.importFacilityCatalogue).not.toHaveBeenCalled();
  });

  it('requires a review, approval and retained identity before a single send', async () => {
    const { onImported } = setup();
    const user = await prepare();
    expect(mocks.api.previewFacilityCatalogueImport).toHaveBeenCalledWith(5, [normalized]);
    const table = screen.getByRole('table', { name: 'Import review' });
    expect(within(table).getByText('125.50')).toBeInTheDocument();
    expect(within(table).getByText('2020-01-01')).toBeInTheDocument();
    expect(mocks.api.importFacilityCatalogue).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send approved batch' })).toBeDisabled();
    expect(screen.getByLabelText('Retry identity').textContent).toMatch(
      /^facility-catalogue-[0-9a-f]{32}$/,
    );
    await user.click(screen.getByLabelText(/I have securely retained/));
    await user.click(screen.getByRole('button', { name: 'Send approved batch' }));
    expect(await screen.findByText(/Batch #21: 1 services recorded/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(mocks.api.importFacilityCatalogue).toHaveBeenCalledTimes(1);
    expect(mocks.api.importFacilityCatalogue.mock.calls[0][0]).toMatchObject({
      facilityId: 5,
      rows: [normalized],
      approvalReference: 'Synthetic approval',
      confirmed: true,
    });
  });

  it('keeps the same immutable request after a lost response, reports NOT_FOUND as uncertain and retries it', async () => {
    mocks.api.importFacilityCatalogue
      .mockRejectedValueOnce(new Error('Synthetic connection interrupted'))
      .mockResolvedValueOnce({ ...result, idempotentReplay: true });
    const { onImported } = setup();
    const user = await prepare();
    const identity = screen.getByLabelText('Retry identity').textContent;
    await user.click(screen.getByLabelText(/I have securely retained/));
    await user.click(screen.getByRole('button', { name: 'Send approved batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome may be unknown');
    expect(screen.getByLabelText('Or paste JSON rows')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close transfer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check current batch status' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A delayed request could still commit',
    );
    expect(mocks.api.getFacilityCatalogueImportStatus).toHaveBeenCalledWith(5, identity, {
      rows: [normalized],
      approvalReference: 'Synthetic approval',
    });
    expect(onImported).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry same batch' }));
    expect(await screen.findByText(/Batch #21: 1 services recorded/)).toHaveTextContent(
      '(existing result)',
    );
    expect(mocks.api.importFacilityCatalogue).toHaveBeenCalledTimes(2);
    expect(mocks.api.importFacilityCatalogue.mock.calls[1][0]).toEqual(
      mocks.api.importFacilityCatalogue.mock.calls[0][0],
    );
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('does not declare an interrupted request successful from an unmatched status', async () => {
    mocks.api.importFacilityCatalogue.mockRejectedValue(new Error('Synthetic interruption'));
    mocks.api.getFacilityCatalogueImportStatus
      .mockResolvedValueOnce({
        status: 'RECORDED',
        batchId: 21,
        rowCount: 1,
        requestMatched: false,
      })
      .mockResolvedValueOnce({ status: 'KEY_IN_USE' })
      .mockResolvedValueOnce({
        status: 'RECORDED',
        batchId: 21,
        rowCount: 1,
        requestMatched: true,
      });
    const { onImported } = setup();
    const user = await prepare();
    await user.click(screen.getByLabelText(/I have securely retained/));
    await user.click(screen.getByRole('button', { name: 'Send approved batch' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Check current batch status' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'original request contents were not checked',
    );
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close transfer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check current batch status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different or older kind of import');
    expect(onImported).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check current batch status' }));
    expect(await screen.findByText(/Batch #21: 1 services recorded/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('recovers an already recorded batch only after matching the retained request and approval', async () => {
    mocks.api.getFacilityCatalogueImportStatus.mockResolvedValue({
      status: 'RECORDED',
      batchId: 21,
      rowCount: 1,
      requestMatched: true,
    });
    const { onImported } = setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    await user.type(
      screen.getByLabelText('Documented facility approval reference'),
      'Synthetic approval',
    );
    await user.type(screen.getByLabelText(/Original retry identity/), 'retained-synthetic-key');
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    expect(await screen.findByText(/Batch #21: 1 services recorded/)).toHaveTextContent(
      '(existing result)',
    );
    expect(mocks.api.getFacilityCatalogueImportStatus).toHaveBeenCalledWith(
      5,
      'retained-synthetic-key',
      {
        rows: [normalized],
        approvalReference: 'Synthetic approval',
      },
    );
    expect(mocks.api.previewFacilityCatalogueImport).not.toHaveBeenCalled();
    expect(mocks.api.importFacilityCatalogue).not.toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('rejects a recorded status that does not explicitly match the retained request', async () => {
    mocks.api.getFacilityCatalogueImportStatus.mockResolvedValue({
      status: 'RECORDED',
      batchId: 21,
      rowCount: 1,
      requestMatched: false,
    });
    const { onImported } = setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    await user.type(
      screen.getByLabelText('Documented facility approval reference'),
      'Synthetic approval',
    );
    await user.type(screen.getByLabelText(/Original retry identity/), 'retained-synthetic-key');
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be matched');
    expect(onImported).not.toHaveBeenCalled();
    expect(mocks.api.importFacilityCatalogue).not.toHaveBeenCalled();
  });

  it('reuses the retained identity for an exact retry when status is not found', async () => {
    const { onImported } = setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    await user.type(
      screen.getByLabelText('Documented facility approval reference'),
      'Synthetic approval',
    );
    await user.type(screen.getByLabelText(/Original retry identity/), 'retained-synthetic-key');
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    await screen.findByRole('table', { name: 'Import review' });
    expect(screen.getByRole('status')).toHaveTextContent('A delayed request may still commit');
    await user.click(screen.getByLabelText(/I reviewed all rows/));
    await user.click(screen.getByRole('button', { name: 'Prepare approved batch' }));
    expect(screen.getByLabelText('Retry identity')).toHaveTextContent('retained-synthetic-key');
    expect(
      screen.getByText(
        /No retry has been sent from this screen; the original may still be in flight/,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText(/I have securely retained/));
    await user.click(screen.getByRole('button', { name: 'Send approved batch' }));
    expect(await screen.findByText(/Batch #21: 1 services recorded/)).toBeInTheDocument();
    expect(mocks.api.importFacilityCatalogue.mock.calls[0][0].idempotencyKey).toBe(
      'retained-synthetic-key',
    );
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('stops when a retained identity belongs to different contents', async () => {
    mocks.api.getFacilityCatalogueImportStatus.mockResolvedValue({ status: 'KEY_IN_USE' });
    setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    await user.type(
      screen.getByLabelText('Documented facility approval reference'),
      'Synthetic approval',
    );
    await user.type(screen.getByLabelText(/Original retry identity/), 'retained-synthetic-key');
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different request');
    expect(mocks.api.previewFacilityCatalogueImport).not.toHaveBeenCalled();
    expect(mocks.api.importFacilityCatalogue).not.toHaveBeenCalled();
  });

  it('does not keep a previous successful review after failed revalidation', async () => {
    mocks.api.previewFacilityCatalogueImport.mockRejectedValueOnce(
      new Error('Synthetic validation outage'),
    );
    setup();
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('Or paste JSON rows'), {
      target: { value: JSON.stringify([normalized]) },
    });
    // First attempt fails; a subsequent successful review may then be invalidated by another failure.
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic validation outage');
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    await screen.findByRole('table', { name: 'Import review' });
    mocks.api.previewFacilityCatalogueImport.mockRejectedValueOnce(
      new Error('Synthetic later outage'),
    );
    await user.click(screen.getByRole('button', { name: 'Validate batch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic later outage');
    expect(screen.queryByRole('table', { name: 'Import review' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Prepare approved batch' }),
    ).not.toBeInTheDocument();
  });

  it('allows read-only export without exposing import controls', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:synthetic'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setup(false);
    expect(screen.queryByRole('button', { name: 'Validate batch' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export catalogue CSV' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Exported 1 catalogue rows');
    expect(mocks.api.exportFacilityCatalogue).toHaveBeenCalledWith(5);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('ignores a late import response after leaving the facility screen', async () => {
    let resolve!: (value: typeof result) => void;
    mocks.api.importFacilityCatalogue.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const onImported = vi.fn();
    const view = render(
      <FacilityCatalogueTransfer
        facilityId={5}
        canManage
        onImported={onImported}
        onClose={() => {}}
      />,
    );
    const user = await prepare();
    await user.click(screen.getByLabelText(/I have securely retained/));
    await user.click(screen.getByRole('button', { name: 'Send approved batch' }));
    await waitFor(() => expect(mocks.api.importFacilityCatalogue).toHaveBeenCalledTimes(1));
    view.unmount();
    resolve(result);
    await Promise.resolve();
    expect(onImported).not.toHaveBeenCalled();
  });
});
