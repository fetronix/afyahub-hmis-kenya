// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  laboratoryReport: vi.fn(),
  radiologyReport: vi.fn(),
  dischargeSummary: vi.fn(),
  openBlob: vi.fn(),
}));
vi.mock('../../api/clients/branding.client.ts', () => ({
  documentClient: mocks,
  openBlob: mocks.openBlob,
}));
import { ClinicalDocumentReport } from '../../components/modules/report-centre/ClinicalDocumentReport.tsx';
beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of [mocks.laboratoryReport, mocks.radiologyReport, mocks.dischargeSummary])
    fn.mockResolvedValue(new Blob(['synthetic'], { type: 'application/pdf' }));
});
afterEach(cleanup);
describe('Reuse authorized clinical PDF workflows', () => {
  for (const [workflow, method] of [
    ['radiology', 'radiologyReport'],
    ['laboratory', 'laboratoryReport'],
    ['discharge', 'dischargeSummary'],
  ] as const)
    it(`uses the existing ${workflow} source document service`, async () => {
      render(<ClinicalDocumentReport workflow={workflow} />);
      fireEvent.change(screen.getByLabelText('Request / admission reference'), {
        target: { value: '7' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Preview / Print PDF' }));
      await waitFor(() => expect(mocks.openBlob).toHaveBeenCalledOnce());
      expect(mocks[method]).toHaveBeenCalledWith(7);
    });
  it('does not call a document endpoint with an invalid reference', async () => {
    render(<ClinicalDocumentReport workflow="radiology" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview / Print PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid');
    expect(mocks.radiologyReport).not.toHaveBeenCalled();
  });
  it('does not open an earlier patient document after reference selection changes', async () => {
    let resolve!: (blob: Blob) => void;
    mocks.radiologyReport.mockImplementationOnce(
      () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    );
    render(<ClinicalDocumentReport workflow="radiology" />);
    fireEvent.change(screen.getByLabelText('Request / admission reference'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview / Print PDF' }));
    fireEvent.change(screen.getByLabelText('Request / admission reference'), {
      target: { value: '8' },
    });
    await act(async () => resolve(new Blob(['synthetic'])));
    expect(mocks.openBlob).not.toHaveBeenCalled();
  });
});
