import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  interpretEligibility,
  maskIdentifier,
  matchedSchemePrefixes,
  schemeMatchesPomsf,
} from '../integrations/dha/dha.eligibility.ts';
import {
  loadDhaConfig,
  describeDhaConfig,
  DHA_SANDBOX_BASE_URL,
} from '../integrations/dha/dha.config.ts';
import {
  DHA_ENDPOINTS,
  DHA_IDENTIFICATION_TYPES,
  type DhaEligibilityResponse,
} from '../integrations/dha/dha.contracts.ts';
import { dhaCall, clearTokenCache, getAccessToken } from '../integrations/dha/dha.client.ts';
import { DhaError } from '../integrations/dha/dha.errors.ts';
import { buildReadinessReport, DHA_OPERATIONS } from '../integrations/dha/dha.readiness.ts';
import { isMockableOperation, mockResponse } from '../integrations/dha/dha.mock.ts';
import {
  DHA_SERVICE_AREAS,
  describeServiceAreaCoverage,
  getServiceArea,
  resolveServiceArea,
  unmappedServiceAreas,
  type ServiceAreaMapping,
} from '../integrations/dha/dha.service-areas.ts';

import { describe, expect, it } from 'vitest';

function registration(text: string, method: string, route: string): number {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:app|router)\\.${method}\\(\\s*'${escaped}'`).exec(text);

  return match ? match.index : -1;
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('DHA / AfyaConnect integration', () => {
  it('1. SCHEME MATCHING', async () => {
    /* The documented rule: POMSF arrives suffixed, match the prefix. */
    expect(schemeMatchesPomsf('POMSF'), 'bare POMSF matches').toBe(true);
    expect(schemeMatchesPomsf('POMSF-047'), 'POMSF-047 matches').toBe(true);
    expect(schemeMatchesPomsf('pomsf-047'), 'matching is case-insensitive').toBe(true);
    expect(!schemeMatchesPomsf('SHIF'), 'SHIF is not POMSF').toBe(true);
    expect(!schemeMatchesPomsf('XPOMSF-047'), 'a prefix must be at the start').toBe(true);
    expect(!schemeMatchesPomsf(''), 'empty string does not match').toBe(true);

    expect(
      matchedSchemePrefixes(['POMSF-047', 'SHIF']).join(','),
      'only POMSF is reported as a matched prefix',
    ).toBe('POMSF');
    expect(
      matchedSchemePrefixes(['TSC', 'USALAMA']).join(','),
      'TSC and USALAMA are recognised',
    ).toBe('TSC,USALAMA');
  });

  it('2. ELIGIBILITY VERDICT', async () => {
    const eligible: DhaEligibilityResponse = {
      requestIdNumber: '123',
      requestIdType: 2,
      isAlive: true,
      schemes: [{ schemeName: 'POMSF-047' }, { schemeName: 'SHIF' }],
      statusCode: 'ELIGIBLE',
      facilityBiometricsEnforced: false,
      whitelistedForOTP: true,
      memberCrNumber: 'CR-1',
    };

    const verdict = interpretEligibility(eligible);

    expect(verdict.eligible, 'a patient with schemes is eligible').toBe(true);
    expect(verdict.pomsfEligible, 'a suffixed POMSF scheme counts as POMSF cover').toBe(true);
    expect(!verdict.deceased, 'a living patient is not blocked').toBe(true);
    expect(verdict.schemes.length, 'both schemes are reported').toBe(2);
    expect(verdict.otpWhitelisted, 'OTP whitelisting is surfaced').toBe(true);
    expect(!verdict.biometricsEnforced, 'biometrics enforcement is surfaced').toBe(true);

    /* Deceased blocks everything, even with schemes present. */
    const deceased = interpretEligibility({
      requestIdNumber: '124',
      requestIdType: 2,
      isAlive: false,
      schemes: [{ schemeName: 'SHIF' }],
    });

    expect(deceased.deceased, 'the deceased flag is set').toBe(true);
    expect(!deceased.eligible, 'a deceased beneficiary is never eligible').toBe(true);

    /* No schemes means not eligible, whatever the status code says. */
    const uncovered = interpretEligibility({
      requestIdNumber: '125',
      requestIdType: 2,
      isAlive: true,
      schemes: [],
      statusCode: 'ELIGIBLE',
    });

    expect(!uncovered.eligible, 'no schemes means not eligible').toBe(true);

    /* Missing schemes entirely must not throw. */
    const sparse = interpretEligibility({ requestIdNumber: '126', requestIdType: 2 });
    expect(!sparse.eligible, 'a response without schemes is not eligible').toBe(true);
    expect(sparse.schemes.length, 'no schemes parsed').toBe(0);

    /* Scheme entries without a name are ignored rather than crashing. */
    const malformed = interpretEligibility({
      requestIdNumber: '127',
      requestIdType: 2,
      schemes: [{}, { schemeName: '' }, { schemeName: 'SHIF' }],
    });

    expect(malformed.schemes.length, 'nameless schemes are dropped').toBe(1);
  });

  it('Masking', async () => {
    expect(maskIdentifier('12345678'), 'only the last four survive').toBe('****5678');
    expect(maskIdentifier('1234'), 'short identifiers are fully masked').toBe('****');
    expect(maskIdentifier('1'), 'single character is masked').toBe('*');
    expect(!maskIdentifier('CR2594484249725-2').includes('CR2594'), 'the prefix is hidden').toBe(
      true,
    );
  });

  it('3. CONFIGURATION AND PRODUCTION GATING', async () => {
    const mock = loadDhaConfig({
      mode: 'mock',
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });
    expect(mock.enabled, 'mock mode is enabled without credentials').toBe(true);
    expect(mock.disabledReason, 'mock has no blocker').toBe(null);

    const sandboxNoCreds = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: DHA_SANDBOX_BASE_URL,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });

    expect(!sandboxNoCreds.enabled, 'sandbox needs credentials').toBe(true);
    expect(
      (sandboxNoCreds.disabledReason ?? '').includes('DHA_CLIENT_ID'),
      'the blocker names the missing credentials',
    ).toBe(true);

    const sandboxNoFacility = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: DHA_SANDBOX_BASE_URL,
      clientId: 'id',
      clientSecret: 'secret',
      facilityCode: null,
    });

    expect(!sandboxNoFacility.enabled, 'sandbox needs a facility code').toBe(true);
    expect(
      (sandboxNoFacility.disabledReason ?? '').includes('DHA_FACILITY_CODE'),
      'the blocker names the facility code',
    ).toBe(true);

    const sandboxOk = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: DHA_SANDBOX_BASE_URL,
      clientId: 'id',
      clientSecret: 'secret',
      facilityCode: 'FID-47-115307-8',
    });

    expect(sandboxOk.enabled, 'a complete sandbox configuration is enabled').toBe(true);

    /* Production is off unless explicitly switched on. */
    const prodBlocked = loadDhaConfig({
      mode: 'production',
      productionOptIn: false,
      baseUrl: 'https://example.dha.go.ke/api/v1',
      clientId: 'id',
      clientSecret: 'secret',
      facilityCode: 'FID-47-115307-8',
    });

    expect(!prodBlocked.enabled, 'production is blocked by default').toBe(true);
    expect(
      (prodBlocked.disabledReason ?? '').includes('DHA_ALLOW_PRODUCTION'),
      'the blocker explains the production switch',
    ).toBe(true);

    const prodNoUrl = loadDhaConfig({
      mode: 'production',
      productionOptIn: true,
      baseUrl: null,
      clientId: 'id',
      clientSecret: 'secret',
      facilityCode: 'FID-47-115307-8',
    });

    expect(!prodNoUrl.enabled, 'production needs a base URL').toBe(true);
  });

  it('No Secret Leakage', async () => {
    const config = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: DHA_SANDBOX_BASE_URL,
      clientId: 'client-id-value',
      clientSecret: 'super-secret-value',
      facilityCode: 'FID-47-115307-8',
    });

    const described = JSON.stringify(describeDhaConfig(config));

    expect(!described.includes('super-secret-value'), 'the secret is not described').toBe(true);
    expect(!described.includes('client-id-value'), 'the client id value is not described').toBe(
      true,
    );
    expect(described.includes('configured'), 'credentials are reported as configured').toBe(true);

    /* The source must not log bodies, tokens or patient payloads. */
    for (const file of [
      'src/integrations/dha/dha.client.ts',
      'src/integrations/dha/dha.service.ts',
      'src/integrations/dha/dha.readiness.ts',
    ]) {
      const source = readRepoFile(file);

      expect(!/console\.log/.test(source), `${file} does not write to stdout`).toBe(true);
      expect(
        !/console\.(error|warn)\([^)]*(token|body|payload)/i.test(source),
        `${file} never logs a token or a payload`,
      ).toBe(true);
      expect(
        !/access_token\s*[:=]\s*['"][^'"]+['"]/.test(source),
        `${file} contains no hardcoded access token`,
      ).toBe(true);
    }
  });

  it('4. DOCUMENTED ENDPOINTS ONLY', async () => {
    /* Literal paths from hie-docs.dha.go.ke. */
    expect(DHA_ENDPOINTS.token, 'token path').toBe('/tenants/token');
    expect(DHA_ENDPOINTS.eligibility, 'eligibility path').toBe('/patients/eligibility');
    expect(DHA_ENDPOINTS.benefits, 'benefits path').toBe('/patients/benefits');
    expect(DHA_ENDPOINTS.interventions, 'interventions path').toBe(
      '/patients/benefits/interventions',
    );
    expect(DHA_ENDPOINTS.utilization, 'utilization path').toBe('/patients/benefits/utilization');
    expect(DHA_ENDPOINTS.subBenefits, 'sub-benefits path').toBe('/patients/sub-benefits');
    expect(DHA_ENDPOINTS.pomsfBalances, 'POMSF path').toBe('/patients/pomsf-balances');
    expect(DHA_ENDPOINTS.authorize, 'authorize path').toBe('/claims/authorize');
    expect(DHA_ENDPOINTS.visit, 'visit path').toBe('/claims/visit');

    /* The documented identification enum, verbatim. */
    expect(DHA_IDENTIFICATION_TYPES.length, 'seven identification types').toBe(7);
    expect(
      (DHA_IDENTIFICATION_TYPES as readonly string[]).includes('ClientRegistry ID'),
      'ClientRegistry ID is available',
    ).toBe(true);
    expect(
      (DHA_IDENTIFICATION_TYPES as readonly string[]).includes('Mandate Number'),
      'Mandate Number is available',
    ).toBe(true);

    /* Nothing is invented: every implemented operation must be listed. */
    for (const operation of DHA_OPERATIONS.filter((item) => item.implemented)) {
      expect(
        operation.path.startsWith('/') || operation.path.startsWith('('),
        `${operation.operation} has a documented-looking path`,
      ).toBe(true);
    }
  });

  it('5. CLIENT BEHAVIOUR', async () => {
    const config = loadDhaConfig({
      mode: 'mock',
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });

    expect(isMockableOperation('eligibility.check'), 'eligibility has a fixture').toBe(true);
    expect(!isMockableOperation('remittance.read'), 'remittance has no fixture').toBe(true);

    /* Mock responses are deterministic. */
    const a = JSON.parse(
      JSON.stringify(
        mockResponse('eligibility.check', {
          query: { identification_number: '12345678' },
        }),
      ),
    );

    const b = JSON.parse(
      JSON.stringify(
        mockResponse('eligibility.check', {
          query: { identification_number: '12345678' },
        }),
      ),
    );

    expect(JSON.stringify(a), 'mock fixtures are deterministic').toBe(JSON.stringify(b));
    expect(a.statusCode, 'the default mock beneficiary is eligible').toBe('ELIGIBLE');
    expect(
      (a.schemes as Array<{ schemeName: string }>).some((s) => s.schemeName === 'POMSF-047'),
      'the mock includes a suffixed POMSF scheme',
    ).toBe(true);

    expect(config.enabled, 'mock config is usable').toBe(true);
  });

  it('Mock Call Is Marked Simulated', async () => {
    const config = loadDhaConfig({
      mode: 'mock',
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });

    const response = await dhaCall<DhaEligibilityResponse>(
      config,
      {},
      {
        operation: 'eligibility.check',
        method: 'GET',
        path: DHA_ENDPOINTS.eligibility,
        query: { identification_number: '12345678', identification_type: 'National ID' },
      },
    );

    expect(response.simulated, 'mock results are marked simulated').toBe(true);
    expect(response.mode, 'the mode is reported').toBe('mock');
    expect(response.data.statusCode, 'the fixture was returned').toBe('ELIGIBLE');

    /* An operation without a fixture must refuse rather than invent one. */
    let refused: DhaError | null = null;

    try {
      await dhaCall(
        config,
        {},
        {
          operation: 'remittance.read',
          method: 'GET',
          path: '/remittance',
        },
      );
    } catch (error) {
      refused = error instanceof DhaError ? error : null;
    }

    expect(refused !== null, 'an unimplemented operation throws').toBe(true);
    expect(refused?.code, 'it is reported as not configured').toBe('NOT_CONFIGURED');
  });

  it('Disabled Client Refuses', async () => {
    const config = loadDhaConfig({
      mode: 'production',
      productionOptIn: false,
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      facilityCode: null,
    });

    let refused: DhaError | null = null;

    try {
      await getAccessToken(config, {});
    } catch (error) {
      refused = error instanceof DhaError ? error : null;
    }

    expect(refused !== null, 'a disabled client refuses to authenticate').toBe(true);
    expect(refused?.code, 'production is reported as blocked').toBe('PRODUCTION_BLOCKED');
  });

  it('Headers And Auth', async () => {
    clearTokenCache();

    const config = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: 'https://sandbox.invalid/api/v1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      facilityCode: 'FID-47-115307-8',
      maxRetries: 0,
    });

    const calls: Array<{ url: string; headers: Record<string, string>; body: string | null }> = [];

    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;

      calls.push({
        url: String(url),
        headers,
        body: typeof init?.body === 'string' ? init.body : null,
      });

      if (String(url).endsWith('/tenants/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-123', expires_in: 3600, token_type: 'Bearer' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          requestIdNumber: '123',
          requestIdType: 2,
          isAlive: true,
          schemes: [{ schemeName: 'POMSF-047' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const response = await dhaCall<DhaEligibilityResponse>(
        config,
        {},
        {
          operation: 'eligibility.check',
          method: 'GET',
          path: DHA_ENDPOINTS.eligibility,
          query: { identification_number: '123', identification_type: 'National ID' },
        },
      );

      expect(calls.length, 'a token call precedes the business call').toBe(2);
      expect(calls[0].url.endsWith('/tenants/token'), 'the token endpoint is documented').toBe(
        true,
      );

      const business = calls[1];

      expect(
        business.url.startsWith('https://sandbox.invalid/api/v1/patients/eligibility'),
        'the documented base path is used',
      ).toBe(true);
      expect(
        business.url.includes('identification_type=National+ID') ||
          business.url.includes('identification_type=National%20ID'),
        'the documented query parameter is sent',
      ).toBe(true);
      expect(business.headers.Authorization, 'the access token is attached').toBe('Bearer tok-123');
      expect(business.headers['X-Facility-Id'], 'the facility registry code is sent').toBe(
        'FID-47-115307-8',
      );
      expect(business.headers['X-Facility-Id-Type'], 'the facility id type is sent').toBe(
        'fr-code',
      );
      expect(response.simulated, 'a real call is not marked simulated').toBe(false);

      /* The token request must not carry a bearer header or facility id. */
      expect(!calls[0].headers.Authorization, 'the token call sends no bearer token').toBe(true);
      expect(!calls[0].headers['X-Facility-Id'], 'the token call sends no facility header').toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      clearTokenCache();
    }
  });

  it('Token Cache', async () => {
    clearTokenCache();

    const config = loadDhaConfig({
      mode: 'sandbox',
      baseUrl: 'https://cache.invalid/api/v1',
      clientId: 'cache-client',
      clientSecret: 'cache-secret',
      facilityCode: 'FID-1',
      maxRetries: 0,
    });

    let tokenCalls = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      tokenCalls += 1;

      return new Response(
        JSON.stringify({ access_token: 'cached-token', expires_in: 3600, token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await getAccessToken(config, {});
      await getAccessToken(config, {});
      await getAccessToken(config, {});

      expect(tokenCalls, 'a valid token is reused rather than re-requested').toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      clearTokenCache();
    }
  });

  it('6. READINESS REPORT', async () => {
    const mock = await buildReadinessReport({
      config: loadDhaConfig({
        mode: 'mock',
        baseUrl: null,
        clientId: null,
        clientSecret: null,
        facilityCode: null,
      }),
    });

    expect(mock.ready, 'mock mode is ready with no configuration').toBe(true);
    expect(mock.blockers.length, 'mock mode has no blockers').toBe(0);
    expect(mock.operations.length > 0, 'the report lists operations').toBe(true);
    expect(
      mock.operations.some((operation) => operation.implemented),
      'some operations are implemented',
    ).toBe(true);
    expect(
      mock.operations.some((operation) => !operation.implemented && operation.blockedReason),
      'unimplemented operations explain why',
    ).toBe(true);

    const blocked = await buildReadinessReport({
      config: loadDhaConfig({
        mode: 'production',
        productionOptIn: false,
        baseUrl: null,
        clientId: null,
        clientSecret: null,
        facilityCode: null,
      }),
      probe: false,
    });

    expect(!blocked.ready, 'production without opt-in is not ready').toBe(true);
    expect(
      blocked.blockers.some((blocker) => blocker.includes('DHA_ALLOW_PRODUCTION')),
      'the production switch appears as a blocker',
    ).toBe(true);
    expect(
      !JSON.stringify(blocked).includes('client_secret'),
      'the report never contains a secret field',
    ).toBe(true);
  });

  it('6B. SERVICE AREA MAPPING', async () => {
    expect(DHA_SERVICE_AREAS.length, 'the eight service areas are defined').toBe(8);

    const ids = new Set(DHA_SERVICE_AREAS.map((area) => area.id));
    expect(ids.size, 'service area ids are unique').toBe(8);

    for (const area of DHA_SERVICE_AREAS) {
      expect(area.sourceTypes.length > 0, `${area.id} resolves from provenance`).toBe(true);
      expect(
        ['OP', 'IP'].includes(area.accessPoint),
        `${area.id} uses a documented access point`,
      ).toBe(true);
      expect(
        ['PER_DIEM', 'FEE_FOR_SERVICE'].includes(area.paymentMechanism),
        `${area.id} uses a documented payment mechanism`,
      ).toBe(true);
      expect(
        ['SHIF', 'UHC', 'ECCIF'].includes(area.fund),
        `${area.id} uses a documented fund`,
      ).toBe(true);

      /* The definition must not carry a code. Codes come from DHA only. */
      expect(
        !Object.prototype.hasOwnProperty.call(area, 'interventionCode'),
        `${area.id} contains no invented intervention code`,
      ).toBe(true);
    }

    /* Every service area the prompt asks for is present. */
    for (const required of [
      'outpatient_consultation',
      'inpatient_admission',
      'laboratory',
      'pharmacy',
      'imaging',
      'theatre_procedure',
      'maternity',
      'emergency',
    ]) {
      expect(ids.has(required as never), `${required} is covered`).toBe(true);
    }

    expect(
      resolveServiceArea({ sourceType: 'LAB_ORDER' })?.id,
      'a lab order resolves to laboratory',
    ).toBe('laboratory');
    expect(
      resolveServiceArea({ sourceType: 'BED_DAY' })?.id,
      'a bed day resolves to inpatient',
    ).toBe('inpatient_admission');
    expect(
      resolveServiceArea({ sourceType: 'RADIOLOGY' })?.id,
      'radiology resolves to imaging',
    ).toBe('imaging');
    expect(
      resolveServiceArea({ sourceType: 'PHARMACY' })?.id,
      'pharmacy resolves to pharmacy',
    ).toBe('pharmacy');
    expect(
      resolveServiceArea({ sourceType: 'PROCEDURE', department: 'theatre' })?.id,
      'theatre resolves to procedures',
    ).toBe('theatre_procedure');

    /* Ambiguous provenance falls back to the department. */
    expect(
      resolveServiceArea({ sourceType: 'CONSULTATION', department: 'emergency' })?.id,
      'an emergency consultation is not billed as a routine visit',
    ).toBe('emergency');

    expect(
      resolveServiceArea({ department: 'maternity' })?.id,
      'maternity resolves from the department alone',
    ).toBe('maternity');
    expect(resolveServiceArea({}) ?? null, 'an empty line resolves to nothing').toBe(null);
    expect(
      resolveServiceArea({ sourceType: 'MANUAL' }) ?? null,
      'a manual line with no department resolves to nothing',
    ).toBe(null);

    /* Coverage reporting */
    const empty = describeServiceAreaCoverage([]);
    expect(empty.length, 'coverage lists every area').toBe(8);
    expect(
      empty.every((item) => !item.mapped),
      'nothing is mapped by default',
    ).toBe(true);
    expect(unmappedServiceAreas([]).length, 'all eight start unmapped').toBe(8);

    const mappings: ServiceAreaMapping[] = [
      {
        serviceArea: 'laboratory',
        interventionCode: 'LAB-001',
        accessPoint: 'OP',
        paymentMechanism: 'FEE_FOR_SERVICE',
        fund: 'SHIF',
        needsPreauth: false,
      },
      {
        serviceArea: 'pharmacy',
        interventionCode: '   ',
        accessPoint: 'OP',
        paymentMechanism: 'FEE_FOR_SERVICE',
        fund: 'SHIF',
        needsPreauth: false,
      },
    ];

    const covered = describeServiceAreaCoverage(mappings);
    expect(
      covered.find((item) => item.serviceArea === 'laboratory')?.mapped === true,
      'a configured area reports as mapped',
    ).toBe(true);
    expect(
      covered.find((item) => item.serviceArea === 'pharmacy')?.mapped === false,
      'whitespace is not an intervention code',
    ).toBe(true);
    expect(unmappedServiceAreas(mappings).length, 'seven areas remain unmapped').toBe(7);

    expect(getServiceArea('laboratory')?.id, 'a known area resolves').toBe('laboratory');
    expect(getServiceArea('astrology') ?? null, 'an unknown area resolves to null').toBe(null);
  });

  it('7. ROUTES', async () => {
    const app = readRepoFile('src/app.ts');
    const wiring = readRepoFile('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    expect(
      wiring.includes("api.use('/integrations', requireFacilityModule('interoperability'))"),
      'the integration surface is gated by the interoperability module',
    ).toBe(true);

    /*
     * The DHA routes moved out of createApp into src/routes/dha.routes.ts.
     * Registration is matched by method and path rather than by the literal
     * text, so the assertions do not depend on where the formatter broke the
     * line or on the router being called `app`. The former separate check
     * that the mapping read is registered is now the GET in the list below,
     * which asserts the same thing more precisely.
     */
    const dha = readRepoFile('src/routes/dha.routes.ts');

    for (const [method, route] of [
      ['get', '/api/integrations/dha/readiness'],
      ['get', '/api/integrations/dha/calls'],
      ['post', '/api/integrations/dha/patients/:id/eligibility'],
      ['get', '/api/integrations/dha/patients/:id/coverage'],
      ['get', '/api/integrations/dha/service-mappings'],
      ['put', '/api/integrations/dha/service-mappings'],
      ['get', '/api/integrations/dha/invoices/:id/interventions'],
    ] as const) {
      expect(
        registration(dha, method, route) > -1,
        `${method.toUpperCase()} ${route} is registered`,
      ).toBe(true);
    }

    const putRoute = registration(dha, 'put', '/api/integrations/dha/service-mappings');
    expect(putRoute > -1, 'the mapping write is a PUT').toBe(true);
    expect(
      dha.slice(putRoute, putRoute + 400).includes("requireAnyPermission('tariffs.manage'"),
      'saving a mapping needs a configuration permission',
    ).toBe(true);

    const eligibility = registration(dha, 'post', '/api/integrations/dha/patients/:id/eligibility');
    expect(
      dha.slice(eligibility, eligibility + 200).includes("requirePermission('patients.read')"),
      'checking eligibility requires patients.read',
    ).toBe(true);
  });
});
