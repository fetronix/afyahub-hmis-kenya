import { mapToHieIdentificationType as extractedMapping } from '../integrations/sha/sha.client-registry.ts';
import { searchClientRegistryPatient } from '../integrations/sha/sha.client-registry.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mapToHieIdentificationType } from '../integrations/sha/sha.adapter.ts';
import {
  identity,
  json,
  mockAdapter,
  stubbedAdapter,
  unavailableAdapter,
} from './support/sha-test-fixtures.ts';

describe('client registry workflow', () => {
  it('preserves identifier mapping and distinguishes simulated missing patients', async () => {
    expect(mapToHieIdentificationType).toBe(extractedMapping);
    expect(mapToHieIdentificationType('NATIONAL_ID')).toBe('National ID');
    expect(mapToHieIdentificationType('CLIENT_REGISTRY_ID')).toBe('ClientRegistry ID');
    expect(
      await mockAdapter().searchClientRegistryPatient({
        ...identity,
        identificationValue: '12344040',
      }),
    ).toMatchObject({ found: false, isSimulated: true, source: 'SANDBOX_SIMULATION' });
    expect(await unavailableAdapter().searchClientRegistryPatient(identity)).toMatchObject({
      found: false,
      isSimulated: false,
      source: 'UNAVAILABLE',
    });
  });
  it('maps a stubbed registry response without reaching a real service', async () => {
    const adapter = stubbedAdapter(async (url) =>
      String(url).includes('/tenants/token')
        ? json({ access_token: 'test-token' })
        : json({
            patients: [
              {
                id: 'CR-TEST',
                first_name: 'Synthetic',
                last_name: 'Person',
                date_of_birth: '2001-02-03T00:00:00Z',
              },
            ],
          }),
    );
    expect(await adapter.searchClientRegistryPatient(identity)).toMatchObject({
      found: true,
      crId: 'CR-TEST',
      fullName: 'Synthetic Person',
      dateOfBirth: '2001-02-03',
      isSimulated: false,
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await searchClientRegistryPatient(mockContext(), identity)).toMatchObject({
      found: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
});
