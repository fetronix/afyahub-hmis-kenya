import {
  submitHiePreauth,
  queryHiePreauths,
  cancelHiePreauth,
} from '../integrations/sha/sha.preauthorization.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mockAdapter, scope, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('preauthorization operations', () => {
  const submit = {
    ...scope,
    consentToken: 'test-consent',
    variant: 'NORMAL' as const,
    isElective: false,
    interventionCode: 'TEST',
    serviceStart: '2026-01-01',
    serviceEnd: '2026-01-01',
    clinicalIndications: 'synthetic',
    diagnoses: [],
    items: [],
  };
  it('keeps simulated submission, query, and cancellation separate', async () => {
    const adapter = mockAdapter();
    expect(await adapter.submitHiePreauth(submit)).toMatchObject({
      accepted: true,
      status: 'SUBMITTED',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      finalApprovedAmountKes: null,
    });
    expect(
      await adapter.queryHiePreauths({
        ...scope,
        consentToken: 'test-consent',
        hiePreauthGuid: 'test-id',
      }),
    ).toMatchObject({ accepted: true, status: 'SUBMITTED', isSimulated: true });
    expect(
      await adapter.cancelHiePreauth({
        ...scope,
        consentToken: 'test-consent',
        reason: 'synthetic',
      }),
    ).toMatchObject({ cancelled: true, isSimulated: true });
  });
  it('does not claim acceptance or cancellation when unconfigured', async () => {
    const adapter = unavailableAdapter();
    expect(await adapter.submitHiePreauth(submit)).toMatchObject({
      accepted: false,
      status: 'CONFIG_MISSING',
      source: 'UNAVAILABLE',
    });
    expect(
      await adapter.cancelHiePreauth({
        ...scope,
        consentToken: 'test-consent',
        reason: 'synthetic',
      }),
    ).toMatchObject({ cancelled: false, source: 'UNAVAILABLE' });
  });
  it('runs the extracted concern with the shared context', async () => {
    const context = mockContext();
    expect(await submitHiePreauth(context, submit)).toMatchObject({
      accepted: true,
      status: 'SUBMITTED',
      isSimulated: true,
    });
    expect(
      await queryHiePreauths(context, { ...scope, consentToken: 'test-consent' }),
    ).toMatchObject({ accepted: true, isSimulated: true });
    expect(
      await cancelHiePreauth(context, {
        ...scope,
        consentToken: 'test-consent',
        reason: 'synthetic',
      }),
    ).toMatchObject({ cancelled: true, isSimulated: true });
  });
});
