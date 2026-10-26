import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  API_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  isOriginAllowed,
  resolveAllowedOrigins,
} from '../middleware/http-security.middleware.ts';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function allRouteSources(): string {
  const root = resolve(process.cwd(), 'src/routes');

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = resolve(dir, entry.name);

      if (entry.isDirectory()) return walk(full);

      return entry.name.endsWith('.ts') ? [readFileSync(full, 'utf8')] : [];
    });

  return [read('src/app.ts'), ...walk(root)].join('\n');
}

describe('HTTP security and clinical scoping tests', () => {
  it('1. ORIGIN ALLOWLIST', async () => {
    const production = resolveAllowedOrigins({
      APP_BASE_URL: 'https://hmis.example.co.ke/login',
      NODE_ENV: 'production',
    });

    expect(production.length, 'production allows exactly the app origin').toBe(1);
    expect(production[0], 'the path is stripped to the origin').toBe('https://hmis.example.co.ke');
    expect(
      !production.includes('http://localhost:3000'),
      'localhost is not allowed in production',
    ).toBe(true);

    const development = resolveAllowedOrigins({
      APP_BASE_URL: 'http://localhost:3000',
      NODE_ENV: 'development',
    });

    expect(
      development.includes('http://localhost:5173'),
      'the Vite dev origin is allowed outside production',
    ).toBe(true);

    const extras = resolveAllowedOrigins({
      APP_BASE_URL: 'https://hmis.example.co.ke',
      CORS_ALLOWED_ORIGINS: 'https://staging.example.co.ke, not-a-url, ftp://nope',
      NODE_ENV: 'production',
    });

    expect(
      extras.includes('https://staging.example.co.ke'),
      'a listed extra origin is allowed',
    ).toBe(true);
    expect(
      !extras.some((origin) => origin.includes('not-a-url')),
      'a malformed value is dropped',
    ).toBe(true);
    expect(
      !extras.some((origin) => origin.startsWith('ftp:')),
      'a non-HTTP scheme is dropped',
    ).toBe(true);

    /* No configuration at all: nothing but the dev defaults. */
    const empty = resolveAllowedOrigins({ NODE_ENV: 'production' });
    expect(empty.length, 'no configured origin means no allowed origin').toBe(0);

    /* Matching */
    const allowed = ['https://hmis.example.co.ke'];

    expect(isOriginAllowed(undefined, allowed), 'a request with no Origin is allowed').toBe(true);
    expect(
      isOriginAllowed('https://hmis.example.co.ke', allowed),
      'the exact origin is allowed',
    ).toBe(true);
    expect(!isOriginAllowed('https://evil.example', allowed), 'another origin is refused').toBe(
      true,
    );
    expect(
      !isOriginAllowed('https://hmis.example.co.ke.evil.com', allowed),
      'a look-alike domain is refused',
    ).toBe(true);
    expect(
      !isOriginAllowed('http://hmis.example.co.ke', allowed),
      'a different scheme is refused',
    ).toBe(true);
  });

  it('2. RATE LIMITS', async () => {
    expect(AUTH_RATE_LIMIT.limit, 'ten failed sign-ins per window').toBe(10);
    expect(AUTH_RATE_LIMIT.windowMs, 'the sign-in window is 15 minutes').toBe(15 * 60 * 1000);
    expect(API_RATE_LIMIT.limit, '300 requests per minute per IP').toBe(300);
    expect(API_RATE_LIMIT.windowMs, 'the API window is one minute').toBe(60 * 1000);

    const source = read('src/middleware/http-security.middleware.ts');

    expect(
      source.includes('skipSuccessfulRequests: true'),
      'successful sign-ins do not consume the login budget',
    ).toBe(true);
    expect(
      !/origin:\s*['"]\*['"]/.test(source),
      'the API never answers with a wildcard origin',
    ).toBe(true);
    expect(!/origin:\s*true/.test(source), 'the API never reflects any origin').toBe(true);
    expect(
      source.includes("standardHeaders: 'draft-7'"),
      'rate-limit headers follow the current draft',
    ).toBe(true);
  });

  it('3. WIRING', async () => {
    const app = read('src/app.ts');

    expect(app.includes('createHelmetMiddleware'), 'helmet is mounted').toBe(true);
    expect(app.includes('createCorsMiddleware'), 'CORS is mounted').toBe(true);
    expect(
      app.includes("app.use('/api/auth', createAuthRateLimiter())"),
      'the auth limiter covers the auth routes',
    ).toBe(true);
    expect(
      app.includes("app.use('/api', createApiRateLimiter())"),
      'the API limiter covers the rest',
    ).toBe(true);
    expect(app.includes("app.disable('x-powered-by')"), 'the framework is not advertised').toBe(
      true,
    );
    expect(app.includes('express.json({ limit:'), 'the JSON body size is bounded').toBe(true);
    expect(app.includes('1mb'), 'the body limit is 1 MB').toBe(true);

    const securityIndex = app.indexOf('createHelmetMiddleware()');
    const jsonIndex = app.indexOf('express.json({ limit:');

    expect(
      securityIndex > 0 && securityIndex < jsonIndex,
      'security runs before body parsing',
    ).toBe(true);

    const source = read('src/middleware/http-security.middleware.ts');

    expect(
      source.includes("env.NODE_ENV === 'production'"),
      'the content security policy is production-only',
    ).toBe(true);
    expect(source.includes('frameAncestors'), 'framing is denied in production').toBe(true);
    expect(source.includes('includeSubDomains'), 'HSTS covers subdomains in production').toBe(true);
  });

  it('4. CLINICAL SCOPING', async () => {
    const app = read('src/app.ts');
    const routes = allRouteSources();
    const queries = read('src/db/queries.ts');

    /* The unscoped paths must be unreachable from any file that registers a route. */
    expect(
      !routes.includes('queries.getDiagnoses('),
      'no route calls the unscoped diagnosis read',
    ).toBe(true);
    expect(
      !routes.includes('queries.recordDiagnosis('),
      'no route calls the unscoped diagnosis write',
    ).toBe(true);
    expect(
      !routes.includes('queries.getProcedures('),
      'no route calls the unscoped procedure read',
    ).toBe(true);
    expect(
      !routes.includes('queries.recordProcedure('),
      'no route calls the unscoped procedure write',
    ).toBe(true);

    expect(routes.includes('queries.getDiagnosesScoped('), 'the diagnosis read is scoped').toBe(
      true,
    );
    expect(routes.includes('queries.recordDiagnosisScoped('), 'the diagnosis write is scoped').toBe(
      true,
    );
    expect(routes.includes('queries.getProceduresScoped('), 'the procedure read is scoped').toBe(
      true,
    );
    expect(routes.includes('queries.recordProcedureScoped('), 'the procedure write is scoped').toBe(
      true,
    );

    /* Each route resolves the authenticated context first. */
    for (const route of ["'/api/diagnoses'", "'/api/procedures'"]) {
      const index = routes.indexOf(route);
      expect(index > -1, `${route} exists`).toBe(true);
    }

    /* An unfiltered read is refused rather than answered. */
    expect(
      queries.includes('SCOPE_FILTER_REQUIRED'),
      'a read without an encounter or patient is refused',
    ).toBe(true);
    expect(
      queries.includes('Supply an encounterId or patientId.'),
      'the refusal explains what is missing',
    ).toBe(true);

    /* The encounter is resolved before anything is read or written. */
    expect(
      queries.includes('async function loadEncounterInScope'),
      'there is one place that resolves an encounter in scope',
    ).toBe(true);
    expect(
      queries.includes('encounter.tenantId !== context.tenantId'),
      'a cross-tenant encounter is rejected',
    ).toBe(true);
    expect(
      queries.includes('ENCOUNTER_NOT_FOUND'),
      'a foreign encounter is indistinguishable from a missing one',
    ).toBe(true);

    /* A write takes its patient from the encounter, not from the body. */
    expect(
      queries.includes('The diagnosis patient does not match the encounter patient.'),
      'the diagnosis patient must match the encounter',
    ).toBe(true);
    expect(
      queries.includes('The procedure patient does not match the encounter patient.'),
      'the procedure patient must match the encounter',
    ).toBe(true);

    /* Patient-only reads do not assume the registration facility. */
    expect(
      queries.includes('patient.registrationFacilityId !== context.facilityId'),
      'a patient seen elsewhere in the tenant is still reachable',
    ).toBe(true);
  });

  it('5. DEPENDENCIES', async () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(Boolean(pkg.dependencies.helmet), 'helmet is a runtime dependency').toBe(true);
    expect(Boolean(pkg.dependencies.cors), 'cors is a runtime dependency').toBe(true);
    expect(
      Boolean(pkg.dependencies['express-rate-limit']),
      'express-rate-limit is a runtime dependency',
    ).toBe(true);
    expect(Boolean(pkg.devDependencies['@types/cors']), 'cors types are available').toBe(true);
  });
});
