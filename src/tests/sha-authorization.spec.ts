import { createVisitAuthorization } from '../integrations/sha/sha.authorization.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { member, mockAdapter, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('visit authorization', () => {
  const request = {
    ...member,
    serviceType: 'OUTPATIENT' as const,
    consentMethod: 'OTP' as const,
    otp: '000000',
    interventions: [],
  };
  it('retains the simulated OTP failure and elective pre-visit state', async () => {
    expect(await mockAdapter().createVisitAuthorization(request)).toMatchObject({
      authorized: false,
      authStatus: 'OTP_REJECTED',
      isSimulated: true,
    });
    expect(
      await mockAdapter().createVisitAuthorization({
        ...request,
        otp: '123456',
        isElectivePreVisit: true,
      }),
    ).toMatchObject({
      authorized: true,
      authStatus: 'AUTHORIZED_PENDING_VISIT',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
  it('does not authorize when credentials are unavailable', async () => {
    expect(await unavailableAdapter().createVisitAuthorization(request)).toMatchObject({
      authorized: false,
      source: 'UNAVAILABLE',
      isSimulated: false,
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await createVisitAuthorization(mockContext(), request)).toMatchObject({
      authorized: false,
      authStatus: 'OTP_REJECTED',
      isSimulated: true,
    });
  });
});
