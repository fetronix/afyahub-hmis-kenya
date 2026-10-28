import { describe, expect, it, vi } from 'vitest';
import {
  describeWhoIcd11Configuration,
  fetchWhoSearch,
  isPlausibleIcd11Code,
  parseWhoSearchResults,
  presentPersistedDiagnosis,
  resetWhoTokenForTests,
  validateExternalDiagnosisCoding,
} from '../../clinical/icd11/icd11.service.ts';

describe('WHO ICD-11 integration (mocked, not a live WHO test)', () => {
  it('does not treat credentials as proof of a connection or claim a complete catalogue', () => {
    const status = describeWhoIcd11Configuration({
      WHO_ICD11_CLIENT_ID: 'mock-id',
      WHO_ICD11_CLIENT_SECRET: 'mock-secret',
      WHO_ICD11_RELEASE_ID: '2025-01',
    });
    expect(status.credentialsConfigured).toBe(true);
    expect(status.connectionVerified).toBe(false);
    expect(status.cacheNotice).toContain('partial');
    expect(JSON.stringify(status)).not.toContain('mock-secret');
  });
  it('parses bounded WHO-shaped mock results and rejects malformed payloads', () => {
    const items = parseWhoSearchResults(
      {
        destinationEntities: [
          {
            theCode: '9Z99',
            title: '<em>Synthetic test diagnosis</em>',
            id: 'http://id.who.int/icd/entity/123',
            matchingPVs: [{ label: 'test keyword' }],
          },
        ],
      },
      '2025-01',
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(items[0]).toMatchObject({
      code: '9Z99',
      title: 'Synthetic test diagnosis',
      releaseId: '2025-01',
      keywords: ['test keyword'],
    });
    expect(() => parseWhoSearchResults({ error: true }, '2025-01', new Date())).toThrow();
    expect(isPlausibleIcd11Code('9Z99')).toBe(true);
    expect(isPlausibleIcd11Code('../not a code')).toBe(false);
  });
  it('authenticates and searches WHO through injected mock transport only', async () => {
    resetWhoTokenForTests();
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'mock-token', expires_in: 300 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            destinationEntities: [{ theCode: '9Z99', title: 'Synthetic test diagnosis' }],
          }),
          { status: 200 },
        ),
      );
    const result = await fetchWhoSearch('synthetic', {
      env: {
        WHO_ICD11_CLIENT_ID: 'mock-id',
        WHO_ICD11_CLIENT_SECRET: 'mock-secret',
        WHO_ICD11_RELEASE_ID: '2025-01',
      },
      fetchImpl: mock,
    });
    expect(result).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1][0])).toContain('/release/11/2025-01/mms/search');
    expect(mock.mock.calls[1][1]?.headers).toMatchObject({ 'API-Version': 'v2' });
    resetWhoTokenForTests();
    await expect(fetchWhoSearch('test', { env: {}, fetchImpl: mock })).rejects.toMatchObject({
      code: 'WHO_NOT_CONFIGURED',
    });
  });
  it('preserves historical ICD-10 even if its code resembles ICD-11', () => {
    expect(
      presentPersistedDiagnosis({
        icd10Code: '8B20',
        icd10Description: 'Historical test',
        codingSystem: 'ICD-10',
      }),
    ).toMatchObject({ codingSystem: 'ICD-10', primaryCode: '8B20', legacyIcd10: { code: '8B20' } });
  });
  it('requires a documented payer coding policy', () => {
    expect(validateExternalDiagnosisCoding({ codingSystem: 'ICD-11', code: '9Z99' })).toMatchObject(
      { valid: false, code: 'PAYER_CODING_POLICY_UNVERIFIED' },
    );
    expect(
      validateExternalDiagnosisCoding({
        codingSystem: 'ICD-11',
        code: '9Z99',
        allowedCodingSystems: ['ICD-10'],
      }),
    ).toMatchObject({ valid: false, code: 'UNSUPPORTED_CODING_SYSTEM' });
  });
});
