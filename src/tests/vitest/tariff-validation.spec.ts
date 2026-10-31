import { describe, expect, it, vi } from 'vitest';
import {
  evaluateTariffConfiguration,
  inspectTariffConfiguration,
} from '../../billing/tariff-validation.service.ts';
import { pool } from '../../db/index.ts';
import type { ResolvableTariff, TariffLink } from '../../billing/tariff-resolver.ts';

const tariff = (id: number, extra: Partial<ResolvableTariff> = {}): ResolvableTariff => ({
  id,
  code: `TEST-${id}`,
  description: 'Synthetic test',
  department: 'laboratory',
  fee: '50.00',
  unit: 'Test',
  isActive: true,
  autoBill: true,
  ...extra,
});
const link = (
  id: number,
  serviceId: number,
  tariffId: number,
  extra: Partial<TariffLink> = {},
) => ({
  id,
  serviceType: 'LAB_TEST',
  serviceId,
  tariffId,
  autoBill: true,
  isActive: true,
  serviceName: null,
  serviceCode: null,
  ...extra,
});
const run = (overrides: Partial<Parameters<typeof evaluateTariffConfiguration>[0]> = {}) =>
  evaluateTariffConfiguration({
    today: '2026-10-30',
    tariffs: [],
    links: [],
    labs: [],
    wards: [],
    inventory: [],
    ...overrides,
  });
describe('Facility tariff configuration assessment', () => {
  it('fails closed when the tariff schema is missing', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql.startsWith('SET TRANSACTION')) return {};
      throw Object.assign(new Error('synthetic missing relation'), { code: '42P01' });
    });
    const connection = vi
      .spyOn(pool, 'connect')
      .mockResolvedValue({ query, release: vi.fn() } as never);
    try {
      await expect(inspectTariffConfiguration(1, 2, 0, 20)).rejects.toMatchObject({
        code: '42P01',
      });
    } finally {
      connection.mockRestore();
    }
  });
  it('runs the charge resolver for every lab, ward and inventory proxy', () => {
    const checks = run({
      tariffs: [
        tariff(1),
        tariff(2, {
          code: 'BED-ICU',
          description: 'ICU bed',
          department: 'inpatient',
          unit: 'Night',
        }),
        tariff(3, {
          code: 'DRUG-SYNTHETIC-MEDICINE',
          description: 'Synthetic medicine',
          department: 'pharmacy',
          unit: 'Tablet',
        }),
      ],
      links: [link(1, 42, 1)],
      labs: [{ id: 42, code: 'LAB-SYN', name: 'Synthetic lab' }],
      wards: [{ id: 7, code: 'ICU', name: 'ICU', wardType: 'ICU' }],
      inventory: [{ id: 8, code: 'MED-1', name: 'Synthetic medicine' }],
    });
    expect(checks.find((c) => c.key === 'LAB_TEST:42')).toMatchObject({
      result: 'RESOLVED',
      tariffId: 1,
      reasons: ['LINK'],
    });
    expect(checks.find((c) => c.key === 'BED_DAY:7')).toMatchObject({
      result: 'RESOLVED',
      tariffId: 2,
    });
    expect(checks.find((c) => c.key === 'INVENTORY_PROXY:8')).toMatchObject({
      result: 'RESOLVED',
      tariffId: 3,
    });
    expect(checks.filter((c) => c.kind === 'FAMILY_SCENARIO')).toHaveLength(8);
  });
  it('reports invalid price, incompatible unit, dates and unusable links without declaring a price approved', () => {
    const checks = run({
      tariffs: [tariff(1, { fee: '0', unit: 'Per day', effectiveTo: '2026-01-01' })],
      links: [link(1, 1, 1), link(2, 33, 1)],
      labs: [{ id: 1, code: 'LAB-1', name: 'Synthetic lab' }],
    });
    expect(checks.find((c) => c.key === 'LAB_TEST:1')).toMatchObject({
      result: 'REVIEW',
      reasons: ['EXPIRED'],
    });
    expect(checks.find((c) => c.key === 'TARIFF:1')).toMatchObject({
      result: 'INVALID',
      reasons: expect.arrayContaining(['INVALID_PRICE', 'EXPIRED', 'UNIT_INCOMPATIBLE:LAB_TEST']),
    });
    expect(checks.find((c) => c.key === 'LINK:2')?.reasons).toContain(
      'MISSING_OR_INACTIVE_LAB_TEST',
    );
    expect(checks.find((c) => c.key === 'LINK:1')?.reasons).toContain('UNIT_INCOMPATIBLE');
  });
  it('reports inactive tariffs, duplicate codes and conflicting links and never arbitrarily resolves them', () => {
    const checks = run({
      tariffs: [tariff(1, { code: 'DUP' }), tariff(2, { code: 'dup', isActive: false })],
      links: [link(1, 42, 1), link(2, 42, 2), link(3, 43, 1, { isActive: false })],
      labs: [{ id: 42, code: 'LAB-X', name: 'Synthetic lab' }],
    });
    expect(checks.find((c) => c.key === 'TARIFF:2')?.reasons).toEqual(
      expect.arrayContaining(['INACTIVE_TARIFF', 'DUPLICATE_TARIFF_CODE']),
    );
    expect(checks.find((c) => c.key === 'LINK:1')?.reasons).toContain('CONFLICTING_ACTIVE_LINKS');
    expect(checks.find((c) => c.key === 'LINK:3')?.reasons).toContain('INACTIVE_LINK');
    expect(checks.find((c) => c.key === 'LAB_TEST:42')).toMatchObject({
      result: 'REVIEW',
      reasons: ['AMBIGUOUS'],
      tariffId: null,
    });
  });
  it('does not assume a specific non-catalogue link is used by a charge path', () => {
    const checks = run({
      tariffs: [tariff(1)],
      links: [link(2, 55, 1, { serviceType: 'PROCEDURE' })],
    });
    expect(checks.find((c) => c.key === 'LINK:2')?.reasons).toContain(
      'SPECIFIC_LINK_NOT_USED_BY_CURRENT_CHARGE_PATH',
    );
  });
  it('labels explicitly manual tariffs without treating absent prices as zero', () => {
    const checks = run({ tariffs: [tariff(1, { autoBill: false }), tariff(2, { fee: 'NaN' })] });
    expect(checks.find((c) => c.key === 'TARIFF:1')?.result).toBe('MANUAL_ONLY');
    expect(checks.find((c) => c.key === 'TARIFF:2')).toMatchObject({
      result: 'INVALID',
      reasons: expect.arrayContaining(['INVALID_PRICE']),
    });
  });
});
