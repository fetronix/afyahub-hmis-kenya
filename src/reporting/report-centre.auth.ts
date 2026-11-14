import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries/tenancy.ts';
import type { ReportEngineId } from './report-catalogue.ts';
import { REPORT_ENGINES, type ReportEngineDefinition } from './report-centre.types.ts';

export type ReportIntent = 'VIEW' | 'PRINT_REQUEST' | 'EXPORT_REQUEST';

// Intent describes the request, not proof that a print or download was delivered.
export class ReportCentreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'ReportCentreError';
  }
}

export function engineId(raw: string): ReportEngineId {
  if (!Object.prototype.hasOwnProperty.call(REPORT_ENGINES, raw)) {
    throw new ReportCentreError('REPORT_NOT_AVAILABLE', 'This report is not available.', 404);
  }
  return raw as ReportEngineId;
}

/** Use the same permission boundary for an option list as for the report it supports. */
export function authorizeReport(
  context: AuthorizationContext,
  rawId: string,
  intent: ReportIntent,
): { id: ReportEngineId; definition: ReportEngineDefinition } {
  const id = engineId(rawId);
  const definition = REPORT_ENGINES[id];
  authorizePermissions(context, definition.permissions);
  if (
    intent !== 'VIEW' &&
    !hasAllPermissions(context, ['reports.export', ...(definition.exportPermissions ?? [])])
  ) {
    throw new ReportCentreError(
      'FORBIDDEN',
      'Report and source-domain export permissions are required.',
      403,
    );
  }
  return { id, definition };
}

export function authorizePermissions(
  context: AuthorizationContext,
  permissions: readonly string[],
) {
  if (context.isSuperAdmin || context.roles.includes('SUPER_ADMIN')) {
    throw new ReportCentreError(
      'FACILITY_ACCOUNT_REQUIRED',
      'A facility account is required.',
      403,
    );
  }
  if (!hasAllPermissions(context, [...permissions])) {
    throw new ReportCentreError(
      'FORBIDDEN',
      'You do not have the required report and domain permissions.',
      403,
    );
  }
}

/** Resolve tenant ownership and disabled/hidden module policy using the same path for reports and options. */
export async function authorizeReportFacility(
  context: AuthorizationContext,
  requestedFacilityId: number,
  sourceModule: ReportEngineDefinition['module'],
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new ReportCentreError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  const enabled = Array.isArray(facility.enabledModules) ? facility.enabledModules : [];
  const hidden = Array.isArray(facility.hiddenModules) ? facility.hiddenModules : [];
  if (
    !['analytics', sourceModule].every(
      (module) => enabled.includes(module) && !hidden.includes(module),
    )
  ) {
    throw new ReportCentreError(
      'FACILITY_MODULE_DISABLED',
      'The report or its source module is unavailable for this facility.',
      403,
    );
  }
  return facility;
}
