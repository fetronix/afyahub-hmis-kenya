/**
 * JaliCare HMIS
 * DHA / AfyaConnect integration
 *
 * Tests the rules that matter more than the plumbing:
 *
 *   1. POMSF is matched as a prefix. Scheme names arrive suffixed
 *      (POMSF-047), and exact equality would quietly tell a civil
 *      servant they have no cover.
 *   2. A beneficiary recorded as deceased blocks everything.
 *   3. Production cannot run without an explicit opt-in.
 *   4. A secret never leaves the process — not in a report, not in an
 *      audit row, not in an error message.
 *   5. Only documented endpoints are called.
 *
 * Run with: npx tsx src/tests/dha.test.ts
 */

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

import {
  dhaCall,
  clearTokenCache,
  getAccessToken,
} from '../integrations/dha/dha.client.ts';

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

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/* ============================================================
   1. SCHEME MATCHING
   ============================================================ */

function testSchemeMatching(): void {
  /* The documented rule: POMSF arrives suffixed, match the prefix. */
  assert(schemeMatchesPomsf('POMSF'), 'bare POMSF matches');
  assert(schemeMatchesPomsf('POMSF-047'), 'POMSF-047 matches');
  assert(schemeMatchesPomsf('pomsf-047'), 'matching is case-insensitive');
  assert(!schemeMatchesPomsf('SHIF'), 'SHIF is not POMSF');
  assert(!schemeMatchesPomsf('XPOMSF-047'), 'a prefix must be at the start');
  assert(!schemeMatchesPomsf(''), 'empty string does not match');

  assertEqual(
    matchedSchemePrefixes(['POMSF-047', 'SHIF']).join(','),
    'POMSF',
    'only POMSF is reported as a matched prefix',
  );
  assertEqual(
    matchedSchemePrefixes(['TSC', 'USALAMA']).join(','),
    'TSC,USALAMA',
    'TSC and USALAMA are recognised',
  );
}

/* ============================================================
   2. ELIGIBILITY VERDICT
   ============================================================ */

function testEligibilityVerdict(): void {
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

  assert(verdict.eligible, 'a patient with schemes is eligible');
  assert(verdict.pomsfEligible, 'a suffixed POMSF scheme counts as POMSF cover');
  assert(!verdict.deceased, 'a living patient is not blocked');
  assertEqual(verdict.schemes.length, 2, 'both schemes are reported');
  assert(verdict.otpWhitelisted, 'OTP whitelisting is surfaced');
  assert(!verdict.biometricsEnforced, 'biometrics enforcement is surfaced');

  /* Deceased blocks everything, even with schemes present. */
  const deceased = interpretEligibility({
    requestIdNumber: '124',
    requestIdType: 2,
    isAlive: false,
    schemes: [{ schemeName: 'SHIF' }],
  });

  assert(deceased.deceased, 'the deceased flag is set');
  assert(!deceased.eligible, 'a deceased beneficiary is never eligible');

  /* No schemes means not eligible, whatever the status code says. */
  const uncovered = interpretEligibility({
    requestIdNumber: '125',
    requestIdType: 2,
    isAlive: true,
    schemes: [],
    statusCode: 'ELIGIBLE',
  });

  assert(!uncovered.eligible, 'no schemes means not eligible');

  /* Missing schemes entirely must not throw. */
  const sparse = interpretEligibility({ requestIdNumber: '126', requestIdType: 2 });
  assert(!sparse.eligible, 'a response without schemes is not eligible');
  assertEqual(sparse.schemes.length, 0, 'no schemes parsed');

  /* Scheme entries without a name are ignored rather than crashing. */
  const malformed = interpretEligibility({
    requestIdNumber: '127',
    requestIdType: 2,
    schemes: [{}, { schemeName: '' }, { schemeName: 'SHIF' }],
  });

  assertEqual(malformed.schemes.length, 1, 'nameless schemes are dropped');
}

function testMasking(): void {
  assertEqual(maskIdentifier('12345678'), '****5678', 'only the last four survive');
  assertEqual(maskIdentifier('1234'), '****', 'short identifiers are fully masked');
  assertEqual(maskIdentifier('1'), '*', 'single character is masked');
  assert(!maskIdentifier('CR2594484249725-2').includes('CR2594'), 'the prefix is hidden');
}

/* ============================================================
   3. CONFIGURATION AND PRODUCTION GATING
   ============================================================ */

function testConfiguration(): void {
  const mock = loadDhaConfig({ mode: 'mock', baseUrl: null, clientId: null, clientSecret: null, facilityCode: null });
  assert(mock.enabled, 'mock mode is enabled without credentials');
  assertEqual(mock.disabledReason, null, 'mock has no blocker');

  const sandboxNoCreds = loadDhaConfig({
    mode: 'sandbox',
    baseUrl: DHA_SANDBOX_BASE_URL,
    clientId: null,
    clientSecret: null,
    facilityCode: null,
  });

  assert(!sandboxNoCreds.enabled, 'sandbox needs credentials');
  assert(
    (sandboxNoCreds.disabledReason ?? '').includes('DHA_CLIENT_ID'),
    'the blocker names the missing credentials',
  );

  const sandboxNoFacility = loadDhaConfig({
    mode: 'sandbox',
    baseUrl: DHA_SANDBOX_BASE_URL,
    clientId: 'id',
    clientSecret: 'secret',
    facilityCode: null,
  });

  assert(!sandboxNoFacility.enabled, 'sandbox needs a facility code');
  assert(
    (sandboxNoFacility.disabledReason ?? '').includes('DHA_FACILITY_CODE'),
    'the blocker names the facility code',
  );

  const sandboxOk = loadDhaConfig({
    mode: 'sandbox',
    baseUrl: DHA_SANDBOX_BASE_URL,
    clientId: 'id',
    clientSecret: 'secret',
    facilityCode: 'FID-47-115307-8',
  });

  assert(sandboxOk.enabled, 'a complete sandbox configuration is enabled');

  /* Production is off unless explicitly switched on. */
  const prodBlocked = loadDhaConfig({
    mode: 'production',
    productionOptIn: false,
    baseUrl: 'https://example.dha.go.ke/api/v1',
    clientId: 'id',
    clientSecret: 'secret',
    facilityCode: 'FID-47-115307-8',
  });

  assert(!prodBlocked.enabled, 'production is blocked by default');
  assert(
    (prodBlocked.disabledReason ?? '').includes('DHA_ALLOW_PRODUCTION'),
    'the blocker explains the production switch',
  );

  const prodNoUrl = loadDhaConfig({
    mode: 'production',
    productionOptIn: true,
    baseUrl: null,
    clientId: 'id',
    clientSecret: 'secret',
    facilityCode: 'FID-47-115307-8',
  });

  assert(!prodNoUrl.enabled, 'production needs a base URL');
}

function testNoSecretLeakage(): void {
  const config = loadDhaConfig({
    mode: 'sandbox',
    baseUrl: DHA_SANDBOX_BASE_URL,
    clientId: 'client-id-value',
    clientSecret: 'super-secret-value',
    facilityCode: 'FID-47-115307-8',
  });

  const described = JSON.stringify(describeDhaConfig(config));

  assert(!described.includes('super-secret-value'), 'the secret is not described');
  assert(!described.includes('client-id-value'), 'the client id value is not described');
  assert(described.includes('configured'), 'credentials are reported as configured');

  /* The source must not log bodies, tokens or patient payloads. */
  for (const file of [
    'src/integrations/dha/dha.client.ts',
    'src/integrations/dha/dha.service.ts',
    'src/integrations/dha/dha.readiness.ts',
  ]) {
    const source = readRepoFile(file);

    assert(!/console\.log/.test(source), `${file} does not write to stdout`);
    assert(
      !/console\.(error|warn)\([^)]*(token|body|payload)/i.test(source),
      `${file} never logs a token or a payload`,
    );
    assert(
      !/access_token\s*[:=]\s*['"][^'"]+['"]/.test(source),
      `${file} contains no hardcoded access token`,
    );
  }
}

/* ============================================================
   4. DOCUMENTED ENDPOINTS ONLY
   ============================================================ */

function testEndpoints(): void {
  /* Literal paths from hie-docs.dha.go.ke. */
  assertEqual(DHA_ENDPOINTS.token, '/tenants/token', 'token path');
  assertEqual(DHA_ENDPOINTS.eligibility, '/patients/eligibility', 'eligibility path');
  assertEqual(DHA_ENDPOINTS.benefits, '/patients/benefits', 'benefits path');
  assertEqual(
    DHA_ENDPOINTS.interventions,
    '/patients/benefits/interventions',
    'interventions path',
  );
  assertEqual(
    DHA_ENDPOINTS.utilization,
    '/patients/benefits/utilization',
    'utilization path',
  );
  assertEqual(DHA_ENDPOINTS.subBenefits, '/patients/sub-benefits', 'sub-benefits path');
  assertEqual(DHA_ENDPOINTS.pomsfBalances, '/patients/pomsf-balances', 'POMSF path');
  assertEqual(DHA_ENDPOINTS.authorize, '/claims/authorize', 'authorize path');
  assertEqual(DHA_ENDPOINTS.visit, '/claims/visit', 'visit path');

  /* The documented identification enum, verbatim. */
  assertEqual(DHA_IDENTIFICATION_TYPES.length, 7, 'seven identification types');
  assert(
    (DHA_IDENTIFICATION_TYPES as readonly string[]).includes('ClientRegistry ID'),
    'ClientRegistry ID is available',
  );
  assert(
    (DHA_IDENTIFICATION_TYPES as readonly string[]).includes('Mandate Number'),
    'Mandate Number is available',
  );

  /* Nothing is invented: every implemented operation must be listed. */
  for (const operation of DHA_OPERATIONS.filter((item) => item.implemented)) {
    assert(
      operation.path.startsWith('/') || operation.path.startsWith('('),
      `${operation.operation} has a documented-looking path`,
    );
  }
}

/* ============================================================
   5. CLIENT BEHAVIOUR
   ============================================================ */

function testMockClient(): void {
  const config = loadDhaConfig({ mode: 'mock', baseUrl: null, clientId: null, clientSecret: null, facilityCode: null });

  assert(isMockableOperation('eligibility.check'), 'eligibility has a fixture');
  assert(!isMockableOperation('remittance.read'), 'remittance has no fixture');

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

  assertEqual(JSON.stringify(a), JSON.stringify(b), 'mock fixtures are deterministic');
  assertEqual(a.statusCode, 'ELIGIBLE', 'the default mock beneficiary is eligible');
  assert(
    (a.schemes as Array<{ schemeName: string }>).some((s) => s.schemeName === 'POMSF-047'),
    'the mock includes a suffixed POMSF scheme',
  );

  assert(config.enabled, 'mock config is usable');
}

async function testMockCallIsMarkedSimulated(): Promise<void> {
  const config = loadDhaConfig({ mode: 'mock', baseUrl: null, clientId: null, clientSecret: null, facilityCode: null });

  const response = await dhaCall<DhaEligibilityResponse>(config, {}, {
    operation: 'eligibility.check',
    method: 'GET',
    path: DHA_ENDPOINTS.eligibility,
    query: { identification_number: '12345678', identification_type: 'National ID' },
  });

  assertEqual(response.simulated, true, 'mock results are marked simulated');
  assertEqual(response.mode, 'mock', 'the mode is reported');
  assertEqual(response.data.statusCode, 'ELIGIBLE', 'the fixture was returned');

  /* An operation without a fixture must refuse rather than invent one. */
  let refused: DhaError | null = null;

  try {
    await dhaCall(config, {}, {
      operation: 'remittance.read',
      method: 'GET',
      path: '/remittance',
    });
  } catch (error) {
    refused = error instanceof DhaError ? error : null;
  }

  assert(refused !== null, 'an unimplemented operation throws');
  assertEqual(refused?.code, 'NOT_CONFIGURED', 'it is reported as not configured');
}

async function testDisabledClientRefuses(): Promise<void> {
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

  assert(refused !== null, 'a disabled client refuses to authenticate');
  assertEqual(refused?.code, 'PRODUCTION_BLOCKED', 'production is reported as blocked');
}

async function testHeadersAndAuth(): Promise<void> {
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
    const response = await dhaCall<DhaEligibilityResponse>(config, {}, {
      operation: 'eligibility.check',
      method: 'GET',
      path: DHA_ENDPOINTS.eligibility,
      query: { identification_number: '123', identification_type: 'National ID' },
    });

    assertEqual(calls.length, 2, 'a token call precedes the business call');
    assert(calls[0].url.endsWith('/tenants/token'), 'the token endpoint is documented');

    const business = calls[1];

    assert(
      business.url.startsWith('https://sandbox.invalid/api/v1/patients/eligibility'),
      'the documented base path is used',
    );
    assert(
      business.url.includes('identification_type=National+ID') ||
        business.url.includes('identification_type=National%20ID'),
      'the documented query parameter is sent',
    );
    assertEqual(
      business.headers.Authorization,
      'Bearer tok-123',
      'the access token is attached',
    );
    assertEqual(
      business.headers['X-Facility-Id'],
      'FID-47-115307-8',
      'the facility registry code is sent',
    );
    assertEqual(
      business.headers['X-Facility-Id-Type'],
      'fr-code',
      'the facility id type is sent',
    );
    assertEqual(response.simulated, false, 'a real call is not marked simulated');

    /* The token request must not carry a bearer header or facility id. */
    assert(!calls[0].headers.Authorization, 'the token call sends no bearer token');
    assert(
      !calls[0].headers['X-Facility-Id'],
      'the token call sends no facility header',
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearTokenCache();
  }
}

async function testTokenCache(): Promise<void> {
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

    assertEqual(tokenCalls, 1, 'a valid token is reused rather than re-requested');
  } finally {
    globalThis.fetch = originalFetch;
    clearTokenCache();
  }
}

/* ============================================================
   6. READINESS REPORT
   ============================================================ */

async function testReadiness(): Promise<void> {
  const mock = await buildReadinessReport({
    config: loadDhaConfig({ mode: 'mock', baseUrl: null, clientId: null, clientSecret: null, facilityCode: null }),
  });

  assert(mock.ready, 'mock mode is ready with no configuration');
  assertEqual(mock.blockers.length, 0, 'mock mode has no blockers');
  assert(mock.operations.length > 0, 'the report lists operations');
  assert(
    mock.operations.some((operation) => operation.implemented),
    'some operations are implemented',
  );
  assert(
    mock.operations.some((operation) => !operation.implemented && operation.blockedReason),
    'unimplemented operations explain why',
  );

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

  assert(!blocked.ready, 'production without opt-in is not ready');
  assert(
    blocked.blockers.some((blocker) => blocker.includes('DHA_ALLOW_PRODUCTION')),
    'the production switch appears as a blocker',
  );
  assert(
    !JSON.stringify(blocked).includes('client_secret'),
    'the report never contains a secret field',
  );
}

/* ============================================================
   6B. SERVICE AREA MAPPING
   ============================================================ */

function testServiceAreas(): void {
  assertEqual(DHA_SERVICE_AREAS.length, 8, 'the eight service areas are defined');

  const ids = new Set(DHA_SERVICE_AREAS.map((area) => area.id));
  assertEqual(ids.size, 8, 'service area ids are unique');

  for (const area of DHA_SERVICE_AREAS) {
    assert(area.sourceTypes.length > 0, `${area.id} resolves from provenance`);
    assert(
      ['OP', 'IP'].includes(area.accessPoint),
      `${area.id} uses a documented access point`,
    );
    assert(
      ['PER_DIEM', 'FEE_FOR_SERVICE'].includes(area.paymentMechanism),
      `${area.id} uses a documented payment mechanism`,
    );
    assert(
      ['SHIF', 'UHC', 'ECCIF'].includes(area.fund),
      `${area.id} uses a documented fund`,
    );

    /* The definition must not carry a code. Codes come from DHA only. */
    assert(
      !Object.prototype.hasOwnProperty.call(area, 'interventionCode'),
      `${area.id} contains no invented intervention code`,
    );
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
    assert(ids.has(required as never), `${required} is covered`);
  }

  assertEqual(resolveServiceArea({ sourceType: 'LAB_ORDER' })?.id, 'laboratory', 'a lab order resolves to laboratory');
  assertEqual(resolveServiceArea({ sourceType: 'BED_DAY' })?.id, 'inpatient_admission', 'a bed day resolves to inpatient');
  assertEqual(resolveServiceArea({ sourceType: 'RADIOLOGY' })?.id, 'imaging', 'radiology resolves to imaging');
  assertEqual(resolveServiceArea({ sourceType: 'PHARMACY' })?.id, 'pharmacy', 'pharmacy resolves to pharmacy');
  assertEqual(resolveServiceArea({ sourceType: 'PROCEDURE', department: 'theatre' })?.id, 'theatre_procedure', 'theatre resolves to procedures');

  /* Ambiguous provenance falls back to the department. */
  assertEqual(
    resolveServiceArea({ sourceType: 'CONSULTATION', department: 'emergency' })?.id,
    'emergency',
    'an emergency consultation is not billed as a routine visit',
  );

  assertEqual(resolveServiceArea({ department: 'maternity' })?.id, 'maternity', 'maternity resolves from the department alone');
  assertEqual(resolveServiceArea({}) ?? null, null, 'an empty line resolves to nothing');
  assertEqual(resolveServiceArea({ sourceType: 'MANUAL' }) ?? null, null, 'a manual line with no department resolves to nothing');

  /* Coverage reporting */
  const empty = describeServiceAreaCoverage([]);
  assertEqual(empty.length, 8, 'coverage lists every area');
  assert(empty.every((item) => !item.mapped), 'nothing is mapped by default');
  assertEqual(unmappedServiceAreas([]).length, 8, 'all eight start unmapped');

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
  assert(covered.find((item) => item.serviceArea === 'laboratory')?.mapped === true, 'a configured area reports as mapped');
  assert(
    covered.find((item) => item.serviceArea === 'pharmacy')?.mapped === false,
    'whitespace is not an intervention code',
  );
  assertEqual(unmappedServiceAreas(mappings).length, 7, 'seven areas remain unmapped');

  assertEqual(getServiceArea('laboratory')?.id, 'laboratory', 'a known area resolves');
  assertEqual(getServiceArea('astrology') ?? null, null, 'an unknown area resolves to null');
}

/* ============================================================
   7. ROUTES
   ============================================================ */

function testRoutes(): void {
  const app = readRepoFile('src/app.ts');

  assert(
    app.includes("app.use('/api/integrations', requireFacilityModule('interoperability'))"),
    'the integration surface is gated by the interoperability module',
  );

  for (const [method, route] of [
    ['get', '/api/integrations/dha/readiness'],
    ['get', '/api/integrations/dha/calls'],
    ['post', '/api/integrations/dha/patients/:id/eligibility'],
    ['get', '/api/integrations/dha/patients/:id/coverage'],
  ] as const) {
    assert(app.includes(`app.${method}(\n    '${route}'`), `${method.toUpperCase()} ${route} is registered`);
  }

  for (const [method, route] of [
    ['get', '/api/integrations/dha/service-mappings'],
    ['put', '/api/integrations/dha/service-mappings'],
    ['get', '/api/integrations/dha/invoices/:id/interventions'],
  ] as const) {
    assert(app.includes(`app.${method}(\n    '${route}'`), `${method.toUpperCase()} ${route} is registered`);
  }

  const mappingWrite = app.indexOf("'/api/integrations/dha/service-mappings'");
  const putRoute = app.indexOf("app.put(\n    '/api/integrations/dha/service-mappings'");
  assert(putRoute > -1, 'the mapping write is a PUT');
  assert(
    app.slice(putRoute, putRoute + 400).includes("requireAnyPermission('tariffs.manage'"),
    'saving a mapping needs a configuration permission',
  );
  assert(mappingWrite > -1, 'the mapping read is registered');

  const eligibility = app.indexOf("'/api/integrations/dha/patients/:id/eligibility'");
  assert(
    app.slice(eligibility, eligibility + 200).includes("requirePermission('patients.read')"),
    'checking eligibility requires patients.read',
  );
}

/* ============================================================
   RUN
   ============================================================ */

async function run(): Promise<void> {
  console.log('');
  console.log('DHA INTEGRATION TESTS');
  console.log('==============================================');

  testSchemeMatching();
  console.log('  1. POMSF is matched by prefix');

  testEligibilityVerdict();
  console.log('  2. Eligibility and the deceased rule');

  testMasking();
  console.log('  3. Identifiers are masked');

  testConfiguration();
  console.log('  4. Modes and the production gate');

  testNoSecretLeakage();
  console.log('  5. No secret survives in a report or a log');

  testEndpoints();
  console.log('  6. Only documented endpoints and enums');

  testMockClient();
  console.log('  7. Mock fixtures are deterministic');

  await testMockCallIsMarkedSimulated();
  console.log('  8. Simulated responses say so');

  await testDisabledClientRefuses();
  console.log('  9. A blocked configuration refuses to call');

  await testHeadersAndAuth();
  console.log(' 10. Auth and facility headers match the documentation');

  await testTokenCache();
  console.log(' 11. Tokens are cached');

  await testReadiness();
  console.log(' 12. The readiness report is honest');

  testServiceAreas();
  console.log(' 12b. Service areas map to documented attributes only');

  testRoutes();
  console.log(' 13. Routes are registered and gated');

  console.log('');
  console.log('==============================================');
  console.log(`DHA INTEGRATION TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

run().catch((error) => {
  console.error('');
  console.error('==============================================');
  console.error('DHA INTEGRATION TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
});
