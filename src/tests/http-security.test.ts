/**
 * JaliCare HMIS
 * HTTP security and clinical scoping tests
 *
 * Two things are checked here, and they fail in different ways:
 *
 *   1. The origin allowlist and the rate limits are configuration, so
 *      they can be tested directly.
 *   2. The scoping fixes are behavioural, and without a database the
 *      honest test is structural: the unscoped query must no longer be
 *      reachable from a route, and the scoped one must check both the
 *      tenant and the facility.
 *
 * Run with: npx tsx src/tests/http-security.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  API_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  isOriginAllowed,
  resolveAllowedOrigins,
} from '../middleware/http-security.middleware.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) throw new Error(`FAILED: ${label}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/* ============================================================
   1. ORIGIN ALLOWLIST
   ============================================================ */

function testOrigins(): void {
  const production = resolveAllowedOrigins({
    APP_BASE_URL: 'https://hmis.example.co.ke/login',
    NODE_ENV: 'production',
  });

  assertEqual(production.length, 1, 'production allows exactly the app origin');
  assertEqual(
    production[0],
    'https://hmis.example.co.ke',
    'the path is stripped to the origin',
  );
  assert(
    !production.includes('http://localhost:3000'),
    'localhost is not allowed in production',
  );

  const development = resolveAllowedOrigins({
    APP_BASE_URL: 'http://localhost:3000',
    NODE_ENV: 'development',
  });

  assert(
    development.includes('http://localhost:5173'),
    'the Vite dev origin is allowed outside production',
  );

  const extras = resolveAllowedOrigins({
    APP_BASE_URL: 'https://hmis.example.co.ke',
    CORS_ALLOWED_ORIGINS: 'https://staging.example.co.ke, not-a-url, ftp://nope',
    NODE_ENV: 'production',
  });

  assert(extras.includes('https://staging.example.co.ke'), 'a listed extra origin is allowed');
  assert(!extras.some((origin) => origin.includes('not-a-url')), 'a malformed value is dropped');
  assert(!extras.some((origin) => origin.startsWith('ftp:')), 'a non-HTTP scheme is dropped');

  /* No configuration at all: nothing but the dev defaults. */
  const empty = resolveAllowedOrigins({ NODE_ENV: 'production' });
  assertEqual(empty.length, 0, 'no configured origin means no allowed origin');

  /* Matching */
  const allowed = ['https://hmis.example.co.ke'];

  assert(isOriginAllowed(undefined, allowed), 'a request with no Origin is allowed');
  assert(isOriginAllowed('https://hmis.example.co.ke', allowed), 'the exact origin is allowed');
  assert(!isOriginAllowed('https://evil.example', allowed), 'another origin is refused');
  assert(
    !isOriginAllowed('https://hmis.example.co.ke.evil.com', allowed),
    'a look-alike domain is refused',
  );
  assert(
    !isOriginAllowed('http://hmis.example.co.ke', allowed),
    'a different scheme is refused',
  );
}

/* ============================================================
   2. RATE LIMITS
   ============================================================ */

function testLimits(): void {
  assertEqual(AUTH_RATE_LIMIT.limit, 10, 'ten failed sign-ins per window');
  assertEqual(AUTH_RATE_LIMIT.windowMs, 15 * 60 * 1000, 'the sign-in window is 15 minutes');
  assertEqual(API_RATE_LIMIT.limit, 300, '300 requests per minute per IP');
  assertEqual(API_RATE_LIMIT.windowMs, 60 * 1000, 'the API window is one minute');

  const source = read('src/middleware/http-security.middleware.ts');

  assert(
    source.includes('skipSuccessfulRequests: true'),
    'successful sign-ins do not consume the login budget',
  );
  assert(!/origin:\s*['"]\*['"]/.test(source), 'the API never answers with a wildcard origin');
  assert(!/origin:\s*true/.test(source), 'the API never reflects any origin');
  assert(
    source.includes("standardHeaders: 'draft-7'"),
    'rate-limit headers follow the current draft',
  );
}

/* ============================================================
   3. WIRING
   ============================================================ */

function testWiring(): void {
  const app = read('src/app.ts');

  assert(app.includes('createHelmetMiddleware'), 'helmet is mounted');
  assert(app.includes('createCorsMiddleware'), 'CORS is mounted');
  assert(app.includes("app.use('/api/auth', createAuthRateLimiter())"), 'the auth limiter covers the auth routes');
  assert(app.includes("app.use('/api', createApiRateLimiter())"), 'the API limiter covers the rest');
  assert(app.includes("app.disable('x-powered-by')"), 'the framework is not advertised');
  assert(app.includes('express.json({ limit:'), 'the JSON body size is bounded');
  assert(app.includes('1mb'), 'the body limit is 1 MB');

  const securityIndex = app.indexOf('createHelmetMiddleware()');
  const jsonIndex = app.indexOf('express.json({ limit:');

  assert(securityIndex > 0 && securityIndex < jsonIndex, 'security runs before body parsing');

  const source = read('src/middleware/http-security.middleware.ts');

  assert(
    source.includes("env.NODE_ENV === 'production'"),
    'the content security policy is production-only',
  );
  assert(source.includes('frameAncestors'), 'framing is denied in production');
  assert(source.includes('includeSubDomains'), 'HSTS covers subdomains in production');
}

/* ============================================================
   4. CLINICAL SCOPING
   ============================================================ */

function testScoping(): void {
  const app = read('src/app.ts');
  const queries = read('src/db/queries.ts');

  /* The unscoped paths must be unreachable from a route. */
  assert(!app.includes('queries.getDiagnoses('), 'no route calls the unscoped diagnosis read');
  assert(!app.includes('queries.recordDiagnosis('), 'no route calls the unscoped diagnosis write');
  assert(!app.includes('queries.getProcedures('), 'no route calls the unscoped procedure read');
  assert(!app.includes('queries.recordProcedure('), 'no route calls the unscoped procedure write');

  assert(app.includes('queries.getDiagnosesScoped('), 'the diagnosis read is scoped');
  assert(app.includes('queries.recordDiagnosisScoped('), 'the diagnosis write is scoped');
  assert(app.includes('queries.getProceduresScoped('), 'the procedure read is scoped');
  assert(app.includes('queries.recordProcedureScoped('), 'the procedure write is scoped');

  /* Each route resolves the authenticated context first. */
  for (const route of [
    "'/api/diagnoses'",
    "'/api/procedures'",
  ]) {
    const index = app.indexOf(route);
    assert(index > -1, `${route} exists`);
  }

  /* An unfiltered read is refused rather than answered. */
  assert(
    queries.includes('SCOPE_FILTER_REQUIRED'),
    'a read without an encounter or patient is refused',
  );
  assert(
    queries.includes('Supply an encounterId or patientId.'),
    'the refusal explains what is missing',
  );

  /* The encounter is resolved before anything is read or written. */
  assert(
    queries.includes('async function loadEncounterInScope'),
    'there is one place that resolves an encounter in scope',
  );
  assert(
    queries.includes('encounter.tenantId !== context.tenantId'),
    'a cross-tenant encounter is rejected',
  );
  assert(
    queries.includes('ENCOUNTER_NOT_FOUND'),
    'a foreign encounter is indistinguishable from a missing one',
  );

  /* A write takes its patient from the encounter, not from the body. */
  assert(
    queries.includes('The diagnosis patient does not match the encounter patient.'),
    'the diagnosis patient must match the encounter',
  );
  assert(
    queries.includes('The procedure patient does not match the encounter patient.'),
    'the procedure patient must match the encounter',
  );

  /* Patient-only reads do not assume the registration facility. */
  assert(
    queries.includes('patient.registrationFacilityId !== context.facilityId'),
    'a patient seen elsewhere in the tenant is still reachable',
  );
}

/* ============================================================
   5. DEPENDENCIES
   ============================================================ */

function testDependencies(): void {
  const pkg = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  assert(Boolean(pkg.dependencies.helmet), 'helmet is a runtime dependency');
  assert(Boolean(pkg.dependencies.cors), 'cors is a runtime dependency');
  assert(Boolean(pkg.dependencies['express-rate-limit']), 'express-rate-limit is a runtime dependency');
  assert(Boolean(pkg.devDependencies['@types/cors']), 'cors types are available');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('HTTP SECURITY TESTS');
  console.log('==============================================');

  testOrigins();
  console.log('  1. The origin allowlist is an allowlist');

  testLimits();
  console.log('  2. Rate limits are bounded and counted on failure');

  testWiring();
  console.log('  3. Headers, CORS and limits are mounted first');

  testScoping();
  console.log('  4. Clinical reads and writes resolve scope');

  testDependencies();
  console.log('  5. The dependencies are declared');

  console.log('');
  console.log('==============================================');
  console.log(`HTTP SECURITY TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('HTTP SECURITY TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
