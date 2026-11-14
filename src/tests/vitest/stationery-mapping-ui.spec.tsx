// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { PlanningImport } from '../../components/modules/planning/PlanningImport.tsx';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const plan = {
  id: 1,
  name: 'Syrona Medical Center Annual Plan 2026',
  financial_year: 2026,
  plan_type: 'MIXED',
  currency: 'KES',
  inflation_bp: 500,
  status: 'DRAFT',
  version: 3,
};
const mappings = [
  { category: 'OPD CONSUMABLES', startRow: 9, endRow: 141 },
  { category: 'DENTAL CONSUABLES', startRow: 145, endRow: 184 },
  { category: 'CONSUMABLE ITEMS', startRow: 186, endRow: 244 },
].map((m) => ({
  ...m,
  sheet: 'CSV',
  kind: 'ITEM',
  description: 'B',
  unit: 'C',
  price: 'D',
  months: ['F', 'H', 'J', 'L', 'N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB'],
}));
let batch: Record<string, any>;
beforeEach(() => {
  vi.resetAllMocks();
  batch = {
    id: 7,
    status: 'UPLOADED',
    sheets: [{ name: 'CSV', rows: 296, preview: [] }],
    verifiedMapping: {
      sourceSha256: 'reviewed-fingerprint',
      sourceRows: 296,
      itemRows: 232,
      excludedRows: 64,
      mappings,
    },
  };
  api.get.mockImplementation(async (_facility, endpoint) =>
    endpoint === '/imports'
      ? [{ id: 7, status: 'UPLOADED' }]
      : endpoint === '/imports/7'
        ? batch
        : { plans: [plan], total: 1 },
  );
});
afterEach(cleanup);
async function open() {
  render(<PlanningImport facilityId={1} plans={[]} onImported={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review batch 7' }));
  await screen.findByRole('option', { name: /Syrona Medical Center Annual Plan 2026/ });
  fireEvent.change(screen.getByLabelText('Existing destination plan'), { target: { value: '1' } });
}
it('fills only local mapping fields and preserves destination, category spelling, source ranges and columns', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Use verified stationery mappings' }));
  await waitFor(() => expect(screen.getAllByLabelText('First source row')).toHaveLength(3));
  expect(
    screen.getAllByLabelText('First source row').map((e) => (e as HTMLInputElement).value),
  ).toEqual(['9', '145', '186']);
  expect(
    screen.getAllByLabelText('Last source row').map((e) => (e as HTMLInputElement).value),
  ).toEqual(['141', '184', '244']);
  expect(
    screen.getAllByLabelText('Source category').map((e) => (e as HTMLInputElement).value),
  ).toEqual(mappings.map((m) => m.category));
  for (const label of [
    'Description column',
    'Unit column',
    'Base price column',
    'January qty column',
    'December qty column',
  ]) {
    const expected = {
      'Description column': 'B',
      'Unit column': 'C',
      'Base price column': 'D',
      'January qty column': 'F',
      'December qty column': 'AB',
    }[label];
    for (const input of screen.getAllByLabelText(label)) expect(input).toHaveValue(expected);
  }
  expect(screen.getByLabelText('Existing destination plan')).toHaveValue('1');
  expect(screen.getByLabelText('Import inflation percentage')).toHaveValue('5');
  expect(screen.getByLabelText('Currency')).toHaveValue('KES');
  expect(screen.getByLabelText('Plan type')).toHaveValue('MIXED');
  expect(
    screen.queryByRole('region', { name: 'Validated import destination' }),
  ).not.toBeInTheDocument();
  expect(api.send).not.toHaveBeenCalled();
  expect(api.upload).not.toHaveBeenCalled();
});
it('does not overwrite an existing incomplete manual mapping', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Add source/category mapping block' }));
  expect(screen.getByLabelText('First source row')).toHaveValue('1');
  expect(screen.getByLabelText('Description column')).toHaveValue('');
  const section = screen.getByRole('region', { name: 'Verified stationery source mapping' });
  expect(
    within(section).getByRole('button', { name: 'Use verified stationery mappings' }),
  ).toBeDisabled();
  expect(screen.getAllByLabelText('First source row')).toHaveLength(1);
  expect(api.send).not.toHaveBeenCalled();
});
it('offers no automatic mapping when the server did not verify the source', async () => {
  batch.verifiedMapping = null;
  await open();
  expect(
    screen.queryByRole('button', { name: 'Use verified stationery mappings' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/parsed record positions/)).toBeInTheDocument();
  expect(api.send).not.toHaveBeenCalled();
});
