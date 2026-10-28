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
  resolveHiddenFacilityModules,
  unknownFacilityModules,
} from '../config/facility-modules.ts';
import { maternityModuleSource } from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

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

describe('Facility module provisioning — contract tests', () => {
  it('1. The catalogue is the single source of truth', async () => {
    expect(FACILITY_MODULES.length === 23, 'The catalogue holds the 23 facility modules').toBe(
      true,
    );

    expect(
      FACILITY_MODULE_IDS.includes('dialysis') &&
        FACILITY_MODULE_IDS.includes('accounting') &&
        FACILITY_MODULE_IDS.includes('website_booking'),
      'Dialysis, accounting, and website booking are first-class provisionable modules',
    ).toBe(true);

    expect(
      new Set(FACILITY_MODULE_IDS).size === FACILITY_MODULE_IDS.length,
      'Module ids are unique',
    ).toBe(true);

    expect(FACILITY_MODULE_IDS.includes('maternity'), 'Maternity is a provisionable module').toBe(
      true,
    );

    expect(
      FACILITY_MODULE_IDS.includes('patient_portal') && !isAlwaysEnabledModule('patient_portal'),
      'Patient portal management is provisionable, not forced on every facility',
    ).toBe(true);

    expect(
      isKnownFacilityModule('maternity') && !isKnownFacilityModule('claims'),
      '`claims` stays a UI alias for `insurance`, not a stored module id',
    ).toBe(true);

    expect(
      isAlwaysEnabledModule('configuration') &&
        ALWAYS_ENABLED_MODULES.length === 1 &&
        ALWAYS_ENABLED_MODULES[0] === 'configuration',
      'Configuration is the only always-on module',
    ).toBe(true);

    const missingDescription = FACILITY_MODULES.filter(
      (module) => module.description.trim().length < 20,
    );

    expect(
      missingDescription.length === 0,
      'Every module explains itself in one honest sentence',
    ).toBe(true);
  });

  it('2. The resolver the UI and the route share', async () => {
    const resolved = resolveFacilityModules(['maternity', 'opd', 'maternity']);

    expect(resolved.includes('maternity') && resolved.includes('opd'), 'Known ids survive').toBe(
      true,
    );
    expect(resolved.filter((id) => id === 'maternity').length === 1, 'Duplicate ids collapse').toBe(
      true,
    );
    expect(resolved.includes('configuration'), 'Configuration is forced on').toBe(true);
    expect(
      resolved.indexOf('opd') < resolved.indexOf('maternity'),
      'Order follows the catalogue, not the request',
    ).toBe(true);

    expect(
      resolveFacilityModules(['not-a-module']).every((id) => isKnownFacilityModule(id)),
      'Unknown ids are dropped when reading an old row',
    ).toBe(true);

    expect(
      resolveFacilityModules(null).length === 1,
      'A null row resolves to Configuration only',
    ).toBe(true);

    const unknown = unknownFacilityModules(['maternity', 'theatre', 'x-ray']);

    expect(
      unknown.length === 1 && unknown[0] === 'x-ray',
      'The write path names unknown ids instead of ignoring them',
    ).toBe(true);

    expect(
      unknownFacilityModules('maternity').length === 0,
      'A non-array is not treated as a list of unknowns',
    ).toBe(true);

    const hidden = resolveHiddenFacilityModules([
      'inpatient',
      'radiology',
      'configuration',
      'inpatient',
      'not-a-module',
    ]);
    expect(
      hidden.length === 2 && hidden[0] === 'inpatient' && hidden[1] === 'radiology',
      'Hidden modules keep catalogue order, drop unknown ids, and never hide Configuration',
    ).toBe(true);
  });

  it('3. The server enforces the same list', async () => {
    const middleware = source('src/middleware/facility-module.middleware.ts');

    for (const id of FACILITY_MODULE_IDS) {
      expect(middleware.includes(`'${id}'`), `The module guard knows "${id}"`).toBe(true);
    }

    expect(
      middleware.includes('FACILITY_MODULE_DISABLED'),
      'A disabled module closes its API, not just its rail entry',
    ).toBe(true);

    const route = source('src/config/facility-modules.routes.ts');

    expect(
      route.includes('router.use(requireAuth)'),
      'Module provisioning requires a session',
    ).toBe(true);
    expect(
      route.includes('getFacilityByIdScoped'),
      'Module provisioning is tenant- and facility-scoped from the database',
    ).toBe(true);
    expect(
      route.includes('db.transaction') && route.includes('tx.insert(schema.auditLogs)'),
      'Module changes and their audit entries commit together',
    ).toBe(true);
    expect(
      route.includes("router.get('/:id/modules'") && route.includes("router.patch('/:id/modules'"),
      'The list can be read and written',
    ).toBe(true);
    expect(
      route.includes('MODULE_PROVISIONING_FORBIDDEN'),
      'A caller without the grant is refused by name',
    ).toBe(true);
    expect(
      route.includes("context.roles.includes('FACILITY_ADMIN')"),
      'A facility administrator may provision its own facility',
    ).toBe(true);

    const wiring = source('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */
    expect(
      wiring.includes("api.use('/facilities', facilityModuleRoutes)"),
      'The provisioning router is mounted',
    ).toBe(true);

    const mountIndex = wiring.indexOf("api.use('/facilities', facilityModuleRoutes)");
    const guardIndex = wiring.indexOf("api.use('/maternity', requireFacilityModule('maternity'))");

    expect(
      mountIndex !== -1 && mountIndex < guardIndex,
      'Provisioning is mounted outside the module guards it controls',
    ).toBe(true);
  });

  it('4. The seeded data and the schema agree', async () => {
    const schema = schemaSource();
    const defaultBlock = schema.slice(
      schema.indexOf('enabledModules: jsonb'),
      schema.indexOf('enabledModules: jsonb') + 900,
    );

    expect(defaultBlock.includes("'maternity'"), 'The schema default enables Maternity').toBe(true);

    const seed = source('src/db/seed.ts');
    const firstFacility = seed.slice(seed.indexOf('NRB-CENTRAL'), seed.indexOf('NRB-SOUTH'));

    expect(
      firstFacility.includes("'maternity'"),
      'The seeded referral hospital enables Maternity',
    ).toBe(true);
  });

  it('5. The screens tell the truth', async () => {
    const configuration = source('src/components/modules/ConfigurationModule.tsx');

    expect(
      configuration.includes('api.updateFacilityModules'),
      'The switch grid saves through the API',
    ).toBe(true);
    expect(
      configuration.includes('resolveFacilityModules(currentFacility?.enabledModules)'),
      'The switch grid starts from the facility row',
    ).toBe(true);
    expect(
      !/maternity:\s*true/.test(configuration),
      'No hard-coded module map remains in the screen',
    ).toBe(true);
    expect(
      configuration.includes("if (isFacilityAdmin) return tab.id !== 'payments'"),
      'A facility administrator can open the module tab',
    ).toBe(true);
    expect(
      configuration.includes('Antenatal register'),
      'The screen names where the antenatal register lives',
    ).toBe(true);
    expect(
      !configuration.includes('Live Reconfiguration Active'),
      'The screen no longer claims a live engine it did not have',
    ).toBe(true);
    expect(
      !configuration.includes('Save Facility Settings'),
      'The screen no longer offers a save button with no endpoint behind it',
    ).toBe(true);

    const sidebar = source('src/components/Sidebar.tsx');

    expect(
      sidebar.includes("if (id === 'configuration') return true;"),
      'The rail cannot hide the screen that provisions modules',
    ).toBe(true);

    const maternity = maternityModuleSource();

    expect(
      maternity.includes('Antenatal register') && maternity.includes("tab === 'anc'"),
      'The antenatal register is the default maternity tab',
    ).toBe(true);
  });
});
