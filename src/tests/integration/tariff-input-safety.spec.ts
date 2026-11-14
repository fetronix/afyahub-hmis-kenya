import { describe, expect, it } from 'vitest';
import { validateTariffInput } from '../../routes/shared/tariffs.ts';

describe('facility tariff input safety', () => {
  const valid = {
    code: 'SYN-1',
    description: 'Synthetic test only',
    department: 'laboratory',
    unit: 'Test',
    fee: '7.50',
  };
  it('requires an explicit unit and rejects impossible effective dates', () => {
    expect(validateTariffInput({ ...valid, unit: undefined })).toBeNull();
    expect(validateTariffInput({ ...valid, effectiveFrom: '2026-02-30' })).toBeNull();
    expect(validateTariffInput({ ...valid, effectiveTo: '2025-02-29' })).toBeNull();
    expect(validateTariffInput({ ...valid, effectiveFrom: '2024-02-29' })).toMatchObject({
      unit: 'Test',
      fee: '7.50',
      effectiveFrom: '2024-02-29',
    });
  });
});
