/**
 * Generate the API reference from the registered-route inventory.
 *
 * Nothing in the reference is typed by hand: every row comes from a route that
 * the running application actually answers, joined to the source registration
 * that declared it. Regenerate after any route change:
 *
 *   set -a && . .tmp-tools/docs.env && set +a
 *   npx tsx scripts/docs/build-api-inventory.ts
 *   npx tsx scripts/docs/build-api-reference.ts
 *
 * Output: docs/06-technical/API_REFERENCE.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const INVENTORY = join(ROOT, 'docs', 'evidence', 'API_ROUTE_INVENTORY.json');
const OUT = join(ROOT, 'docs', '06-technical', 'API_REFERENCE.md');

interface Route {
  method: string;
  path: string;
  file: string | null;
  permissions: string[];
  anyPermissions: string[];
  superAdmin: boolean;
  facilityAdmin: boolean;
  moduleGates: string[];
  description: string;
  public: boolean;
  auth: 'session' | 'portal' | 'none';
  bodySchema: string | null;
  querySchema: string | null;
  facilityScoped: boolean;
  binary: boolean;
  serviceCall: string | null;
  serviceAuthorisation: boolean;
  source: string | null;
}

interface Inventory {
  generatedAt: string;
  totals: {
    effectiveRoutes: number;
    staticRegistrations: number;
    matchedToSource: number;
    publicRoutes: number;
    guardedRoutes: number;
    prefixes: number;
  };
  prefixCounts: { prefix: string; routes: number }[];
  routes: Route[];
}

const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as Inventory;

const ACTION_VERBS: Record<string, string> = {
  approve: 'Approve',
  reject: 'Reject',
  submit: 'Submit',
  cancel: 'Cancel',
  verify: 'Verify',
  validate: 'Validate',
  activate: 'Activate',
  deactivate: 'Deactivate',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
  revoke: 'Revoke',
  reissue: 'Reissue',
  release: 'Release',
  reseal: 'Re-seal',
  close: 'Close',
  reopen: 'Reopen',
  post: 'Post',
  reverse: 'Reverse',
  reconcile: 'Reconcile',
  export: 'Export',
  import: 'Import',
  preview: 'Preview',
  search: 'Search',
  download: 'Download',
  upload: 'Upload',
  reset: 'Reset',
  execute: 'Execute',
  complete: 'Complete',
  dispatch: 'Dispatch',
  settle: 'Settle',
  collect: 'Collect',
  recover: 'Recover',
  acknowledge: 'Acknowledge',
  accept: 'Accept',
  decline: 'Decline',
  decisions: 'Record decisions',
  decision: 'Record a decision',
  history: 'History',
  audit: 'Audit trail',
  options: 'Reference options',
  overview: 'Overview',
  summary: 'Summary',
  statements: 'Statements',
  catalogue: 'Catalogue',
};

const words = (segment: string) => segment.replace(/[-_]/g, ' ');

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

const singular = (word: string) => {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
};

/** A short, derived label; the source comment wins when the route has one. */
function purpose(route: Route): string {
  if (route.description) return route.description;
  const parts = route.path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const prefix = parts[0] ?? '';
  const rest = parts.slice(1);
  const staticRest = rest.filter((part) => !part.startsWith(':'));
  const hasId = rest.some((part) => part.startsWith(':'));
  const noun = singular(staticRest[staticRest.length - 1] ?? prefix);
  const collection = staticRest.length
    ? words(staticRest.slice(-2).join(' '))
    : words(prefix).replace(/ /g, '');
  const last = (staticRest[staticRest.length - 1] ?? '').toLowerCase();
  const verb = ACTION_VERBS[last];
  if (verb) return staticRest.length > 1 ? `${verb}: ${collection}` : verb;
  switch (route.method) {
    case 'GET':
      return hasId ? `Read ${article(noun)} ${words(noun)}` : `List ${collection || words(prefix)}`;
    case 'POST':
      return `Create ${hasId ? `action on ${article(noun)} ${words(noun)}` : `${article(noun)} ${words(noun)}`}`;
    case 'PUT':
    case 'PATCH':
      return `Update ${article(noun)} ${words(noun)}`;
    case 'DELETE':
      return `Delete ${article(noun)} ${words(noun)}`;
    default:
      return collection || words(prefix);
  }
}

const authLabel = (route: Route) =>
  route.auth === 'session' ? 'Staff session' : route.auth === 'portal' ? 'Patient portal' : 'Public';

const permissionLabel = (route: Route) => {
  const codes = [...route.permissions, ...route.anyPermissions.map((code) => `${code} (any)`)]
    .map((code) => `\`${code}\``)
    .join(', ');
  if (codes) return codes;
  if (route.superAdmin) return '`requireSuperAdmin`';
  if (route.facilityAdmin) return 'facility administrator';
  if (route.serviceAuthorisation) return 'checked in service';
  return '—';
};

const inputLabel = (route: Route) => {
  const parts: string[] = [];
  if (route.bodySchema) parts.push(`body \`${route.bodySchema}\``);
  if (route.querySchema) parts.push(`query \`${route.querySchema}\``);
  return parts.join('; ') || '—';
};

const groups = new Map<string, Route[]>();
for (const route of inventory.routes) {
  const parts = route.path.split('/').filter(Boolean);
  const prefix = parts[0] === 'api' ? (parts[1] ?? 'root') : (parts[0] ?? 'root');
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix)!.push(route);
}

const md: string[] = [];
const publicRoutes = inventory.routes.filter((route) => route.public);
const portalRoutes = inventory.routes.filter((route) => route.auth === 'portal');

md.push('# API reference');
md.push('');
md.push(
  '> Generated from the registered routes of the running application by ' +
    '`scripts/docs/build-api-reference.ts`. Every path below was walked from the Express router ' +
    'tree of `createApp()` and matched back to the source registration that declares it; there are ' +
    'no handwritten endpoints. Regenerate after any route change.',
);
md.push('');
md.push(`Generated: ${inventory.generatedAt.slice(0, 10)}`);
md.push('');
md.push('**Intended audience:** integrators, frontend developers, QA engineers, security reviewers.');
md.push('');
md.push('## Scope and method');
md.push('');
md.push('| Measure | Value |');
md.push('| --- | --- |');
md.push(`| Effective HTTP routes | ${inventory.totals.effectiveRoutes} |`);
md.push(`| Route registrations parsed from source | ${inventory.totals.staticRegistrations} |`);
md.push(`| Routes matched to a source registration | ${inventory.totals.matchedToSource} |`);
md.push(`| Unauthenticated routes | ${inventory.totals.publicRoutes} |`);
md.push(`| Routes behind a permission or administrator guard | ${inventory.totals.guardedRoutes} |`);
md.push(`| Path prefixes | ${inventory.totals.prefixes} |`);
md.push('');
md.push(
  'Permissions are read from the handler chain and from router-level guards: a `requirePermission` ' +
    'call on the router itself applies to every route registered on it and is reported here as if ' +
    'it were written on each route. Where no permission appears, authorisation is either absent by ' +
    'design (public routes) or decided inside the service that receives the request context; the ' +
    'last case is marked "checked in service".',
);
md.push('');
md.push('## Authentication and authorisation');
md.push('');
md.push('One process serves both the JSON API and the single-page application. `POST /api/auth/login`');
md.push('returns a session token. Clients send it as `Authorization: Bearer <token>` on every request;');
md.push('the server stores only the SHA-256 hash of the token in `sessions`, and the session expires eight');
md.push('hours after issue. The browser SPA keeps the token in `localStorage` under');
md.push('`syrona_session_token`. The patient portal uses a separate token, a separate table');
md.push('(`patient_portal_sessions`) and a separate middleware (`requirePortalAuth`), so a portal token');
md.push('cannot call staff endpoints and vice versa.');
md.push('');
md.push('The API is mounted in this order (from `src/app.ts`):');
md.push('');
md.push('1. Unauthenticated probes and public endpoints: `/api/health`, `/api/ready`, `/api/auth` login and invitation acceptance, `/api/webhooks/sha`, `/api/payment-hub/webhooks`, `/api/booking/v1`, `/api/portal`.');
md.push('2. The API rate limiter.');
md.push('3. `app.use(\'/api\', requireAuth)` — everything registered afterwards requires a staff session.');
md.push('4. `app.use(\'/api\', requireAuthorization)` — tenant, facility and module checks.');
md.push('5. Module gates (`requireFacilityModule`) and domain routers.');
md.push('6. A JSON 404 handler for unmatched `/api` paths, so an unknown endpoint never returns the SPA shell.');
md.push('');
md.push(
  `There are ${publicRoutes.length} unauthenticated routes. Most are login and invitation entry points, ` +
    'the public booking API used by the website, and liveness probes. The SHA eClaims webhook is ' +
    'authenticated by a shared secret and a signature check inside the handler rather than by a session.',
);
md.push('');
md.push('## Request conventions');
md.push('');
md.push('| Topic | Convention |');
md.push('| --- | --- |');
md.push('| Base path | Every endpoint is under `/api`. Paths in this reference are absolute. |');
md.push('| Content type | JSON bodies (`application/json`), except document upload, which sends raw bytes with the `X-Document-Metadata` header; letterhead and document downloads return a file. |');
md.push('| Validation | Zod schemas validate the body and query string before the handler runs; the schema that a route uses is named in the *Input* column. |');
md.push('| Identifiers | Database identifiers are integers. Path parameters are validated and rejected with `400` when they are not positive integers. |');
md.push('| Facility context | Handlers resolve the facility from the session. A `facilityId` in the body or query is accepted only when it agrees with the session; a mismatch is `403`. |');
md.push('| Dates | Calendar dates are `YYYY-MM-DD`; timestamps are ISO 8601. The server runs in the timezone configured for the deployment (`TZ`). |');
md.push('| Pagination | Applied per endpoint, not globally: list endpoints accept `page`/`pageSize` or a `paginate=1` flag that returns an envelope. Where an endpoint has no paging, the *Input* column shows no paging schema and the response is the full result set for the scope. |');
md.push('');
md.push('## Response conventions');
md.push('');
md.push('Successful responses return JSON. Most write endpoints return `{ "success": true, ... }`;');
md.push('read endpoints return the record or list directly. File endpoints return the file bytes with a');
md.push('`Content-Type` and `Content-Disposition` header.');
md.push('');
md.push('Errors share a small number of shapes:');
md.push('');
md.push('```json');
md.push('{ "success": false, "error": "VALIDATION_ERROR", "code": "VALIDATION_ERROR",');
md.push('  "message": "Request validation failed.", "issues": [{ "path": "amount", "message": "..." }] }');
md.push('```');
md.push('');
md.push('```json');
md.push('{ "success": false, "error": "RATE_LIMITED", "message": "Too many requests. Slow down and try again shortly." }');
md.push('```');
md.push('');
md.push('```json');
md.push('{ "success": false, "error": "NOT_FOUND", "message": "No API route matches GET /api/example." }');
md.push('```');
md.push('');
md.push('| Status | Meaning in this API |');
md.push('| --- | --- |');
md.push('| 400 | Validation failed, or a path/body value is not acceptable. |');
md.push('| 401 | No session, an expired session, or unusable credentials. |');
md.push('| 403 | The session is valid but the role, facility, module or scope does not allow the action. |');
md.push('| 404 | The route does not exist (JSON, never the SPA shell) or the scoped record does not exist. |');
md.push('| 409 | A state conflict, such as a duplicate identifier or a document already released. |');
md.push('| 422 | A business rule rejected the request. |');
md.push('| 429 | Rate limit exceeded. |');
md.push('| 500 | An unhandled failure; the message is deliberately generic and the detail is logged. |');
md.push('');
md.push('## Rate limits');
md.push('');
md.push('| Limiter | Window | Limit | Behaviour |');
md.push('| --- | --- | --- | --- |');
md.push('| Login | 15 minutes | 10 failed attempts per IP | Successful sign-ins do not count. Exceeding it returns `429`. |');
md.push('| API | 1 minute | 300 requests per IP | Applies to every `/api` request, authenticated or not. Returns `429`. |');
md.push('');
md.push('Limits are configured in `src/middleware/http-security.middleware.ts` and are raised in the test environment.');
md.push('');
md.push('## Endpoints by prefix');
md.push('');
md.push('| Prefix | Routes | Share |');
md.push('| --- | --- | --- |');
for (const entry of inventory.prefixCounts) {
  md.push(`| [\`/api/${entry.prefix}\`](#api${entry.prefix.replace(/_/g, '-')}) | ${entry.routes} | ${((entry.routes / inventory.routes.length) * 100).toFixed(1)}% |`);
}
md.push('');
md.push('---');
md.push('');

for (const [prefix, routes] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const gated = [...new Set(routes.flatMap((route) => route.moduleGates))];
  const permissions = [...new Set(routes.flatMap((route) => route.permissions))];
  md.push(`## /api/${prefix}`);
  md.push('');
  md.push(`${routes.length} routes.`);
  md.push('');
  if (gated.length) {
    md.push(`Facility module gate: ${gated.map((module) => `\`${module}\``).join(', ')}.`);
    md.push('');
  }
  if (permissions.length) {
    md.push(
      `${permissions.length} distinct permission codes are required across this prefix: ` +
        permissions.map((code) => `\`${code}\``).join(', ') +
        '.',
    );
    md.push('');
  }
  md.push('| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const scope = route.facilityScoped ? 'facility' : '—';
    const handler = route.serviceCall ? `\`${route.serviceCall}\`` : '—';
    const binary = route.binary ? ' (file)' : '';
    md.push(
      `| ${route.method} | \`${route.path}\`${binary} | ${purpose(route)} | ${authLabel(route)} | ` +
        `${permissionLabel(route)} | ${inputLabel(route)} | ${scope} | ${handler} | \`${route.source ?? '—'}\` |`,
    );
  }
  md.push('');
}

md.push('## Appendix: unauthenticated endpoints');
md.push('');
md.push('| Method | Route | Purpose |');
md.push('| --- | --- | --- |');
for (const route of publicRoutes.sort((a, b) => a.path.localeCompare(b.path))) {
  md.push(`| ${route.method} | \`${route.path}\` | ${purpose(route)} |`);
}
md.push('');
md.push('## Appendix: patient portal endpoints');
md.push('');
md.push('| Method | Route | Purpose |');
md.push('| --- | --- | --- |');
for (const route of portalRoutes.sort((a, b) => a.path.localeCompare(b.path))) {
  md.push(`| ${route.method} | \`${route.path}\` | ${purpose(route)} |`);
}
md.push('');
md.push('## Limitations');
md.push('');
md.push('- Response bodies are described by convention, not generated per endpoint: the reference names the validated input schema and the service function, and the module manuals describe the payloads that matter.');
md.push('- Purpose labels are derived from the registered path and the source comment. They are reliable enough to navigate, not a substitute for the handler.');
md.push('- The reference describes the routes that exist. It does not certify them as complete, tested or exposed in the navigation; use the [traceability matrix](../DOCUMENTATION_TRACEABILITY_MATRIX.md) and the module manuals for status.');
md.push('- Webhook contracts (SHA, payment hub) are described in [the integrations area](../07-integrations/README.md), because their callers are external systems rather than this UI.');
md.push('');
md.push('## Related documents');
md.push('');
md.push('- [System architecture](SYSTEM_ARCHITECTURE.md)');
md.push('- [Authentication and authorisation](AUTHENTICATION_AND_AUTHORISATION.md)');
md.push('- [Multitenancy architecture](MULTITENANCY_ARCHITECTURE.md)');
md.push('- [Permissions matrix](../05-administration/PERMISSIONS_MATRIX.md)');
md.push('- [Database data dictionary](DATABASE_DATA_DICTIONARY.md)');
md.push('');

writeFileSync(OUT, `${md.join('\n')}\n`);
console.info('API reference', {
  routes: inventory.routes.length,
  prefixes: groups.size,
  public: publicRoutes.length,
  portal: portalRoutes.length,
});
process.exit(0);
