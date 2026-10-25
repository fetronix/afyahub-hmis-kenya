/**
 * JaliCare HMIS
 * Facility module provisioning — contract tests
 *
 * The bug this suite exists for was silent in every direction:
 *
 *   - the antenatal register was built and routed, but the facility
 *     row seeded without `maternity`, so the rail never drew it;
 *   - Configuration showed a switch grid with `maternity: true`
 *     hard-coded in local state, so the screen said the module was on;
 *   - the switches never called an API, and a facility administrator
 *     could not even reach the tab that held them.
 *
 * Nothing here needs a database. These are contract checks over the
 * catalogue, the resolver, the route wiring and the two screens.
 *
 * Run with: npx tsx src/tests/facility-modules.test.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ALWAYS_ENABLED_MODULES,
  FACILITY_MODULES,
  FACILITY_MODULE_IDS,
  isAlwaysEnabledModule,
  isKnownFacilityModule,
  resolveFacilityModules,
  unknownFacilityModules,
} from '../config/facility-modules.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/**
 * The schema, as one searchable string.
 *
 * `src/db/schema.ts` used to hold every table. It is being split into
 * domain modules under `src/db/schema/`, so a table's definition may now
 * live in either place. Reading only the barrel made this suite fail the
 * moment `facilities` moved - which is the correct alarm for a text
 * assertion, but the wrong thing to leave it doing.
 *
 * Concatenating the barrel and its modules keeps the assertion's intent
 * (the schema declares this default) while surviving the split.
 */
function schemaSource(): string {
  const modules = resolve(root, 'src/db/schema');
  let text = source('src/db/schema.ts');

  try {
    for (const file of readdirSync(modules).filter((f) => f.endsWith('.ts'))) {
      text += '\n' + readFileSync(resolve(modules, file), 'utf8');
    }
  } catch {
    /* No modules yet: the barrel is the whole schema. */
  }

  return text;
}

/* ============================================================
   1. The catalogue is the single source of truth
   ============================================================ */

function testCatalogue(): void {
  assert(FACILITY_MODULES.length === 20, 'The catalogue holds the 20 facility modules');

  assert(
    new Set(FACILITY_MODULE_IDS).size === FACILITY_MODULE_IDS.length,
    'Module ids are unique',
  );

  assert(
    FACILITY_MODULE_IDS.includes('maternity'),
    'Maternity is a provisionable module',
  );

  assert(
    FACILITY_MODULE_IDS.includes('patient_portal') &&
      !isAlwaysEnabledModule('patient_portal'),
    'Patient portal management is provisionable, not forced on every facility',
  );

  assert(
    isKnownFacilityModule('maternity') && !isKnownFacilityModule('claims'),
    '`claims` stays a UI alias for `insurance`, not a stored module id',
  );

  assert(
    isAlwaysEnabledModule('configuration') &&
      ALWAYS_ENABLED_MODULES.length === 1 &&
      ALWAYS_ENABLED_MODULES[0] === 'configuration',
    'Configuration is the only always-on module',
  );

  const missingDescription = FACILITY_MODULES.filter(
    (module) => module.description.trim().length < 20,
  );

  assert(
    missingDescription.length === 0,
    'Every module explains itself in one honest sentence',
  );
}

/* ============================================================
   2. The resolver the UI and the route share
   ============================================================ */

function testResolver(): void {
  const resolved = resolveFacilityModules(['maternity', 'opd', 'maternity']);

  assert(resolved.includes('maternity') && resolved.includes('opd'), 'Known ids survive');
  assert(resolved.filter((id) => id === 'maternity').length === 1, 'Duplicate ids collapse');
  assert(resolved.includes('configuration'), 'Configuration is forced on');
  assert(
    resolved.indexOf('opd') < resolved.indexOf('maternity'),
    'Order follows the catalogue, not the request',
  );

  assert(
    resolveFacilityModules(['not-a-module']).every((id) => isKnownFacilityModule(id)),
    'Unknown ids are dropped when reading an old row',
  );

  assert(resolveFacilityModules(null).length === 1, 'A null row resolves to Configuration only');

  const unknown = unknownFacilityModules(['maternity', 'theatre', 'x-ray']);

  assert(
    unknown.length === 1 && unknown[0] === 'x-ray',
    'The write path names unknown ids instead of ignoring them',
  );

  assert(
    unknownFacilityModules('maternity').length === 0,
    'A non-array is not treated as a list of unknowns',
  );
}

/* ============================================================
   3. The server enforces the same list
   ============================================================ */

function testServerContract(): void {
  const middleware = source('src/middleware/facility-module.middleware.ts');

  for (const id of FACILITY_MODULE_IDS) {
    assert(
      middleware.includes(`'${id}'`),
      `The module guard knows "${id}"`,
    );
  }

  assert(
    middleware.includes('FACILITY_MODULE_DISABLED'),
    'A disabled module closes its API, not just its rail entry',
  );

  const route = source('src/config/facility-modules.routes.ts');

  assert(route.includes('router.use(requireAuth)'), 'Module provisioning requires a session');
  assert(
    route.includes('getFacilityByIdScoped'),
    'Module provisioning is tenant- and facility-scoped from the database',
  );
  assert(route.includes('logAuditEvent'), 'Module changes are audited');
  assert(
    route.includes("router.get('/:id/modules'") && route.includes("router.patch('/:id/modules'"),
    'The list can be read and written',
  );
  assert(
    route.includes('MODULE_PROVISIONING_FORBIDDEN'),
    'A caller without the grant is refused by name',
  );
  assert(
    route.includes("context.roles.includes('FACILITY_ADMIN')"),
    'A facility administrator may provision its own facility',
  );

  const app = source('src/app.ts');

  assert(
    app.includes("app.use('/api/facilities', facilityModuleRoutes)"),
    'The provisioning router is mounted',
  );

  const mountIndex = app.indexOf("app.use('/api/facilities', facilityModuleRoutes)");
  const guardIndex = app.indexOf("app.use('/api/maternity', requireFacilityModule('maternity'))");

  assert(
    mountIndex !== -1 && mountIndex < guardIndex,
    'Provisioning is mounted outside the module guards it controls',
  );
}

/* ============================================================
   4. The seeded data and the schema agree
   ============================================================ */

function testData(): void {
  const schema = schemaSource();
  const defaultBlock = schema.slice(
    schema.indexOf('enabledModules: jsonb'),
    schema.indexOf('enabledModules: jsonb') + 900,
  );

  assert(defaultBlock.includes("'maternity'"), 'The schema default enables Maternity');

  const seed = source('src/db/seed.ts');
  const firstFacility = seed.slice(seed.indexOf('NRB-CENTRAL'), seed.indexOf('NRB-SOUTH'));

  assert(
    firstFacility.includes("'maternity'"),
    'The seeded referral hospital enables Maternity',
  );
}

/* ============================================================
   5. The screens tell the truth
   ============================================================ */

function testScreens(): void {
  const configuration = source('src/components/modules/ConfigurationModule.tsx');

  assert(
    configuration.includes('api.updateFacilityModules'),
    'The switch grid saves through the API',
  );
  assert(
    configuration.includes('resolveFacilityModules(currentFacility?.enabledModules)'),
    'The switch grid starts from the facility row',
  );
  assert(
    !/maternity:\s*true/.test(configuration),
    'No hard-coded module map remains in the screen',
  );
  assert(
    configuration.includes("if (isFacilityAdmin) return tab.id !== 'payments'"),
    'A facility administrator can open the module tab',
  );
  assert(
    configuration.includes('Antenatal register'),
    'The screen names where the antenatal register lives',
  );
  assert(
    !configuration.includes('Live Reconfiguration Active'),
    'The screen no longer claims a live engine it did not have',
  );
  assert(
    !configuration.includes('Save Facility Settings'),
    'The screen no longer offers a save button with no endpoint behind it',
  );

  const sidebar = source('src/components/Sidebar.tsx');

  assert(
    sidebar.includes("if (id === 'configuration') return true;"),
    'The rail cannot hide the screen that provisions modules',
  );

  const maternity = source('src/components/modules/MaternityModule.tsx');

  assert(
    maternity.includes('Antenatal register') && maternity.includes("tab === 'anc'"),
    'The antenatal register is the default maternity tab',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('FACILITY MODULES — CONTRACT TESTS');
  console.log('==============================================');

  testCatalogue();
  console.log('  1. The catalogue is one list with 19 modules');
  testResolver();
  console.log('  2. The resolver forces Configuration and names unknowns');
  testServerContract();
  console.log('  3. The server guard and the provisioning route agree');
  testData();
  console.log('  4. The schema default and the demo seed enable Maternity');
  testScreens();
  console.log('  5. The module screen saves, and the rail cannot hide it');

  console.log('');
  console.log('==============================================');
  console.log(`FACILITY MODULE TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('FACILITY MODULE TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
