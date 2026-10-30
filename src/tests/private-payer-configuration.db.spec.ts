import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, expect, it, vi } from 'vitest';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { assignPayer, registerPayer, updatePayer } from '../insurance/hub/service.ts';
import {
  createPrivatePayer,
  getPayerCapabilitiesScoped,
  getPayerRowScoped,
  listPrivatePayers,
  probeAndPersistPayerConnectionStatus,
  serializePayerConfig,
  toPayerRuntimeConfig,
  updatePrivatePayer,
} from '../insurance/payers/payer-config.service.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

/** Synthetic manual payer only; no real endpoints, credentials or provider contact. */
describeDb('private payer configuration safety', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  const payerCode = `TEST${suffix.toUpperCase()}`;
  const disabledCode = `OFF${suffix.toUpperCase()}`;
  let tenantId: number;
  let facilityId: number;
  let otherFacilityId: number;
  let actorUserId: number;
  let actorUserUid: string;
  let providerId: number;
  let payerId: number;
  const scope = () => ({ tenantId, facilityId, actorUserId, actorUserUid });
  const createInput = () => ({ payerCode, payerName: 'Synthetic payer' });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic config tenant',
        `config-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      'INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,$4),($1,$3,$5) RETURNING id',
      [tenantId, `CFG-A-${suffix}`, `CFG-B-${suffix}`, 'Synthetic A', 'Synthetic B'],
    );
    [facilityId, otherFacilityId] = facilities.rows.map((row) => row.id);
    actorUserUid = `config-user-${suffix}`;
    actorUserId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic test user','not-for-login',$3,$4) RETURNING id`,
        [actorUserUid, `${actorUserUid}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id;
    const registered = await registerPayer(actorUserId, {
      code: payerCode,
      displayName: 'Synthetic payer',
      informationUrl: 'https://example.test/payer',
    });
    providerId = registered.id;
    await updatePayer(actorUserId, providerId, { status: 'ACTIVE' });
    await assignPayer(actorUserId, providerId, facilityId, true);
    await registerPayer(actorUserId, {
      code: disabledCode,
      displayName: 'Synthetic disabled payer',
      informationUrl: 'https://example.test/disabled',
    });
    const created = await createPrivatePayer({
      ...scope(),
      input: {
        ...createInput(),
        isActive: true,
        integrationType: 'MANUAL',
        adapterKey: 'manual',
        providerIdentifier: 'synthetic-reference',
      },
    });
    payerId = created.id;
  });

  it('requires a registered, enabled and assigned platform payer', async () => {
    await expect(
      createPrivatePayer({ ...scope(), input: { ...createInput(), payerCode: 'UNKNOWN_TEST' } }),
    ).rejects.toMatchObject({ code: 'PAYER_NOT_REGISTERED' });
    await expect(
      createPrivatePayer({ ...scope(), input: { ...createInput(), payerCode: disabledCode } }),
    ).rejects.toMatchObject({ code: 'PAYER_DISABLED' });
    await expect(
      createPrivatePayer({ ...scope(), facilityId: otherFacilityId, input: createInput() }),
    ).rejects.toMatchObject({ code: 'PAYER_NOT_ASSIGNED' });
    expect(await listPrivatePayers({ tenantId, facilityId: otherFacilityId })).toEqual([]);
    expect(
      (await listPrivatePayers({ tenantId, facilityId })).map((item) => item.payerCode),
    ).toContain(payerCode);
  });

  it('rejects malformed configuration and raw secret inputs without changing the payer', async () => {
    const invalid: Array<[Record<string, unknown>, string]> = [
      [{ integrationType: 'UNKNOWN' }, 'INVALID_INTEGRATION_TYPE'],
      [{ environment: 'UNKNOWN' }, 'INVALID_ENVIRONMENT'],
      [{ authMethod: 'UNKNOWN' }, 'INVALID_AUTH_METHOD'],
      [{ adapterKey: 'UNKNOWN' }, 'INVALID_ADAPTER_KEY'],
      [{ apiBaseUrl: 'http://example.invalid' }, 'INSECURE_API_BASE_URL'],
      [{ apiKey: randomUUID() }, 'RAW_SECRET_FORBIDDEN'],
      [{ payerCode: 'x' }, 'INVALID_PAYER_CODE'],
      [{ payerName: ' ' }, 'INVALID_PAYER_NAME'],
    ];
    for (const [change, code] of invalid) {
      await expect(
        createPrivatePayer({ ...scope(), input: { ...createInput(), ...change } }),
      ).rejects.toMatchObject({ code });
    }
    const configs = await pool.query(
      'SELECT count(*)::int AS count FROM insurance_payer_configs WHERE tenant_id=$1 AND payer_code=$2',
      [tenantId, payerCode],
    );
    expect(configs.rows[0].count).toBe(1);
  });

  it('prevents facility configuration from changing the adapter, claiming live transport or enabling production', async () => {
    const forbidden: Array<[Record<string, unknown>, string]> = [
      [{ adapterKey: 'britam_direct' }, 'ADAPTER_IMMUTABLE'],
      [{ payerName: 'Another insurer' }, 'PAYER_NAME_IMMUTABLE'],
      [{ apiBaseUrl: 'https://example.invalid' }, 'LIVE_ADAPTER_UNAVAILABLE'],
      [{ secretEnvPrefix: 'TEST_REFERENCE' }, 'SECRET_REFERENCE_FORBIDDEN'],
      [{ environment: 'PRODUCTION' }, 'PAYER_PRODUCTION_BLOCKED'],
      [{ integrationType: 'DIRECT_API' }, 'LIVE_ADAPTER_UNAVAILABLE'],
      [{ authMethod: 'OAUTH2_CLIENT_CREDENTIALS' }, 'LIVE_ADAPTER_UNAVAILABLE'],
    ];
    for (const [input, code] of forbidden) {
      await expect(updatePrivatePayer({ ...scope(), payerId, input })).rejects.toMatchObject({
        code,
      });
    }
    await expect(
      updatePrivatePayer({ ...scope(), facilityId: otherFacilityId, payerId, input: {} }),
    ).rejects.toMatchObject({ code: 'PAYER_NOT_FOUND' });
  });

  it('updates allowed facility settings while preserving manual, unverified status and audit history', async () => {
    const result = await updatePrivatePayer({
      ...scope(),
      payerId,
      input: {
        payerName: 'Synthetic payer',
        isActive: true,
        integrationType: 'FILE_EXPORT',
        adapterKey: 'manual',
        gatewayProvider: null,
        environment: 'SANDBOX',
        apiBaseUrl: null,
        authMethod: 'NONE',
        secretEnvPrefix: null,
        providerIdentifier: 'synthetic-local-reference',
        contractedSchemes: ['TEST-SCHEME'],
        defaultCodingSystem: 'TEST-CODING',
        requireVerifiedEligibility: true,
        eligibilityMaxAgeHours: 0,
        claimRequirements: { requireDiagnosis: true },
        preauthRequirements: { requirePreauthForImaging: true },
        notes: 'synthetic only',
      },
    });
    expect(result).toMatchObject({
      payerCode,
      integrationType: 'FILE_EXPORT',
      environment: 'SANDBOX',
      adapterKey: 'manual',
      connectionStatus: 'NOT_CONFIGURED',
      apiBaseUrl: null,
      eligibilityMaxAgeHours: 1,
      supportedOperations: [],
      capabilities: [],
      providerIdentifier: 'synthetic-local-reference',
    });
    expect(result.preauthRequirements).toMatchObject({ requirePreauthForImaging: true });
    const audit = await pool.query(
      "SELECT action FROM audit_logs WHERE tenant_id=$1 AND resource='insurance_payer_config' AND resource_id=$2 ORDER BY id",
      [tenantId, String(payerId)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'PRIVATE_INSURANCE_PAYER_CREATED',
        'PRIVATE_INSURANCE_PAYER_UPDATED',
      ]),
    );
  });

  it('does not expose shared prefixes or legacy endpoints and reports no verified connection', async () => {
    const [row] = await db
      .select()
      .from(schema.insurancePayerConfigs)
      .where(eq(schema.insurancePayerConfigs.id, payerId));
    const legacyRow = {
      ...row,
      secretEnvPrefix: 'PAYER_HUB_T999_F999_TEST_NOT_THIS_FACILITY',
      apiBaseUrl: 'https://legacy.invalid',
      connectionStatus: 'CONNECTION_VERIFIED',
    };
    expect(toPayerRuntimeConfig(legacyRow).secretEnvPrefix).toBeNull();
    expect(serializePayerConfig(legacyRow)).toMatchObject({
      apiBaseUrl: null,
      connectionStatus: 'NOT_CONFIGURED',
      secretReference: { envPrefix: null },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    try {
      const probe = await probeAndPersistPayerConnectionStatus({
        tenantId,
        facilityId,
        payerId,
        actorUserId,
      });
      expect(probe).toMatchObject({ verified: false, connectionStatus: 'NOT_CONFIGURED' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    const capabilities = await getPayerCapabilitiesScoped({ tenantId, facilityId, payerId });
    expect(capabilities).toMatchObject({ isGatewayAdapter: false, capabilities: [] });
    await expect(getPayerRowScoped({ tenantId, facilityId })).rejects.toMatchObject({
      code: 'PAYER_IDENTIFIER_REQUIRED',
    });
  });
});
