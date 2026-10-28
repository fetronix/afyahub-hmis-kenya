import { hasPermission } from '../../auth/authorization.service.ts';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { resolveFacilityScope, ScopeAccessError } from '../../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';
import { pool } from '../../db/index.ts';
import {
  assertPayerAccess,
  facilityPatient,
  PayerHubError,
  type PayerScope,
  type PayerWorkflow,
} from './service.ts';

function body(req: AuthRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}
export async function operationalScope(req: AuthRequest): Promise<PayerScope> {
  const context = req.authContext;
  if (!context || context.isSuperAdmin)
    throw new ScopeAccessError('A facility-scoped account is required.');
  const q = req.query.facilityId;
  const b = body(req).facilityId;
  if (q != null && b != null && Number(q) !== Number(b))
    throw new ScopeAccessError('Facility identifiers do not match.');
  const raw = b ?? q;
  const parsed = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed <= 0))
    throw new ScopeAccessError('Invalid facility.');
  const facilityId = resolveFacilityScope(context, parsed);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility || facility.tenantId !== context.tenantId)
    throw new ScopeAccessError('Facility not found.');
  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('insurance'))
    throw new PayerHubError('FACILITY_MODULE_DISABLED', 'The insurance module is disabled.', 403);
  return { tenantId: facility.tenantId, facilityId, actorUserId: context.userId };
}
function requirePatientRead(req: AuthRequest) {
  if (!req.authContext || !hasPermission(req.authContext, 'patients.read'))
    throw new PayerHubError(
      'PATIENT_PERMISSION_REQUIRED',
      'Patient-record permission is required for this workflow.',
      403,
    );
}
function fail(res: Response, error: unknown) {
  if (error instanceof PayerHubError)
    return res
      .status(error.status)
      .json({ success: false, error: error.code, message: error.message });
  if (error instanceof ScopeAccessError)
    return res
      .status(403)
      .json({ success: false, error: error.code, message: 'Facility access denied.' });
  return res.status(500).json({
    success: false,
    error: 'PAYER_POLICY_ERROR',
    message: 'Unable to enforce payer policy.',
  });
}
type Table =
  | 'insurance_payer_configs'
  | 'insurance_member_policies'
  | 'payer_benefit_rules'
  | 'payer_service_code_mappings'
  | 'insurance_preauthorizations'
  | 'private_insurance_claims'
  | 'insurance_remittances';
async function payerForRecord(scope: PayerScope, table: Table, recordId: unknown): Promise<string> {
  const n = Number(recordId);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new PayerHubError('INVALID_ID', 'A valid record identifier is required.');
  // The table is a closed, code-owned allowlist, never a request parameter.
  const r = await pool.query(
    `SELECT payer_code AS "payerCode" FROM ${table} WHERE id=$1 AND tenant_id=$2 AND facility_id=$3`,
    [n, scope.tenantId, scope.facilityId],
  );
  if (!r.rowCount)
    throw new PayerHubError('RECORD_NOT_FOUND', 'Record not found in this facility.', 404);
  return r.rows[0].payerCode;
}
async function patientIfSupplied(scope: PayerScope, raw: unknown) {
  if (raw === undefined || raw === null || raw === '') return;
  if (!(await facilityPatient(scope.tenantId, scope.facilityId, Number(raw))))
    throw new PayerHubError(
      'PATIENT_NOT_FOUND',
      'Patient is not associated with this facility.',
      404,
    );
}

/** Protect every operational SHA route while retaining facility-scoped historical reads. */
export async function shaPolicyGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const scope = await operationalScope(req);
    const input = body(req);
    if (
      !['/configuration', '/connection-status', '/service-mappings', '/benefit-rules'].includes(
        req.path,
      ) &&
      !req.path.startsWith('/service-mappings/') &&
      !req.path.startsWith('/benefit-rules/')
    )
      requirePatientRead(req);
    if (input.payerCode !== undefined && String(input.payerCode).trim().toUpperCase() !== 'SHA')
      throw new PayerHubError('PAYER_MISMATCH', 'The SHA route is limited to SHA.');
    await patientIfSupplied(scope, input.patientId);
    const patientPath = req.path.match(/^\/patients\/(\d+)\//);
    if (patientPath) await patientIfSupplied(scope, patientPath[1]);
    const externalOperation =
      req.path === '/registry/patient-search' ||
      req.path === '/eligibility/check' ||
      req.path === '/benefits/hie-lookup' ||
      req.path === '/authorizations/consent' ||
      /^\/preauthorizations\/\d+\/(submit|status|cancel)$/.test(req.path) ||
      /^\/claims\/\d+\/(submit|resubmit|status)$/.test(req.path) ||
      req.path === '/remittances/sync' ||
      /^\/remittances\/\d+\/claims$/.test(req.path) ||
      req.path === '/callbacks/register';
    if (
      req.method === 'GET' &&
      !externalOperation &&
      req.path !== '/configuration' &&
      req.path !== '/connection-status'
    )
      return next();
    let workflow: PayerWorkflow = 'CONFIGURE';
    if (req.path.startsWith('/eligibility') || req.path.startsWith('/registry'))
      workflow = 'ELIGIBILITY';
    else if (req.path.startsWith('/benefit')) workflow = 'BENEFITS';
    else if (req.path.startsWith('/service-mappings')) workflow = 'MAPPINGS';
    else if (req.path.startsWith('/preauthorizations') || req.path.startsWith('/authorizations'))
      workflow = 'PREAUTHORIZATION';
    else if (req.path.startsWith('/claims'))
      workflow = /\/(submit|resubmit)$/.test(req.path)
        ? 'CLAIM_SUBMIT'
        : /\/(status|adjudicate)$/.test(req.path)
          ? 'CLAIM_STATUS'
          : 'CLAIM_PREPARE';
    else if (req.path.startsWith('/remittances')) workflow = 'RECONCILIATION';
    await assertPayerAccess(scope, 'SHA', workflow, {
      configuration: workflow === 'CONFIGURE',
      external: externalOperation,
    });
    return next();
  } catch (error) {
    return fail(res, error);
  }
}

/** Resolve payer identity from the authoritative record, never from an unrelated body. */
export async function privatePolicyGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const scope = await operationalScope(req);
    const input = body(req);
    if (
      !req.path.startsWith('/payers') &&
      req.path !== '/diagnostics' &&
      !req.path.startsWith('/mappings')
    )
      requirePatientRead(req);
    await patientIfSupplied(scope, input.patientId);
    const patientPath = req.path.match(/^\/patients\/(\d+)\//);
    if (patientPath) await patientIfSupplied(scope, patientPath[1]);
    const path = req.path;
    const method = req.method;
    const payerPath = path.match(/^\/payers\/(\d+)(?:\/(capabilities|connection-status))?$/);
    if (method === 'GET' && !payerPath && !/^\/claims\/\d+\/status$/.test(path)) return next();
    let workflow: PayerWorkflow;
    let recordCode: string | undefined;
    let configuration = false;
    if (path === '/payers' && method === 'POST') {
      workflow = 'CONFIGURE';
      configuration = true;
    } else if (payerPath) {
      workflow = 'CONFIGURE';
      configuration = true;
      recordCode = await payerForRecord(scope, 'insurance_payer_configs', payerPath[1]);
    } else if (path === '/members' && method === 'POST') workflow = 'MEMBERSHIP';
    else if (/^\/members\/\d+$/.test(path) && method === 'PATCH') {
      workflow = 'MEMBERSHIP';
      recordCode = await payerForRecord(scope, 'insurance_member_policies', path.split('/')[2]);
    } else if (path === '/eligibility/check' && method === 'POST') {
      workflow = 'ELIGIBILITY';
      if (input.memberPolicyId)
        recordCode = await payerForRecord(scope, 'insurance_member_policies', input.memberPolicyId);
    } else if (path === '/benefits' && method === 'POST') workflow = 'BENEFITS';
    else if (path === '/benefits/validate' && method === 'POST') workflow = 'BENEFITS';
    else if (/^\/benefits\/\d+$/.test(path) && method === 'PATCH') {
      workflow = 'BENEFITS';
      recordCode = await payerForRecord(scope, 'payer_benefit_rules', path.split('/')[2]);
    } else if (path === '/mappings' && method === 'POST') workflow = 'MAPPINGS';
    else if (/^\/mappings\/\d+$/.test(path) && method === 'PATCH') {
      workflow = 'MAPPINGS';
      recordCode = await payerForRecord(scope, 'payer_service_code_mappings', path.split('/')[2]);
    } else if (path === '/preauthorizations' && method === 'POST') {
      workflow = 'PREAUTHORIZATION';
      if (input.memberPolicyId)
        recordCode = await payerForRecord(scope, 'insurance_member_policies', input.memberPolicyId);
    } else if (/^\/preauthorizations\/\d+(?:\/(?:submit|attachments))?$/.test(path)) {
      workflow = 'PREAUTHORIZATION';
      recordCode = await payerForRecord(scope, 'insurance_preauthorizations', path.split('/')[2]);
    } else if (path === '/claims/prepare' && method === 'POST') {
      workflow = 'CLAIM_PREPARE';
      recordCode = await payerForRecord(scope, 'insurance_member_policies', input.memberPolicyId);
    } else if (/^\/claims\/\d+(?:\/(?:validate|submit|resubmit|decision|status))?$/.test(path)) {
      workflow = /\/(submit|resubmit)$/.test(path)
        ? 'CLAIM_SUBMIT'
        : /\/(status|decision)$/.test(path)
          ? 'CLAIM_STATUS'
          : 'CLAIM_PREPARE';
      recordCode = await payerForRecord(scope, 'private_insurance_claims', path.split('/')[2]);
    } else if (path === '/remittances/import' && method === 'POST') workflow = 'RECONCILIATION';
    else if (/^\/remittances\/\d+\/reconcile$/.test(path) && method === 'POST') {
      workflow = 'RECONCILIATION';
      recordCode = await payerForRecord(scope, 'insurance_remittances', path.split('/')[2]);
    } else
      throw new PayerHubError(
        'PAYER_OPERATION_UNCLASSIFIED',
        'This insurance operation is not enabled by policy.',
        403,
      );
    const requestedCode =
      input.payerCode === undefined ? undefined : String(input.payerCode).trim().toUpperCase();
    if (recordCode && requestedCode && recordCode.toUpperCase() !== requestedCode)
      throw new PayerHubError('PAYER_MISMATCH', 'Payer does not match the selected record.');
    const payer = recordCode ?? requestedCode;
    if (!payer) throw new PayerHubError('PAYER_REQUIRED', 'A registered payer is required.');
    if (payer.toUpperCase() === 'SHA')
      throw new PayerHubError(
        'PAYER_MISMATCH',
        'Use the dedicated SHA workspace for SHA operations.',
      );
    const mode = String(input.submissionMode ?? '')
      .trim()
      .toUpperCase();
    const external =
      (path === '/eligibility/check' &&
        String(input.verificationMode ?? 'ADAPTER').toUpperCase() !== 'MANUAL') ||
      (/^\/preauthorizations\/\d+\/submit$/.test(path) && mode !== 'MANUAL') ||
      (/^\/claims\/\d+\/(submit|resubmit)$/.test(path) &&
        !!mode &&
        !['MANUAL', 'MANUAL_DISPATCH', 'FILE_EXPORT'].includes(mode)) ||
      /^\/claims\/\d+\/status$/.test(path) ||
      (method === 'GET' && /^\/payers\/\d+\/connection-status$/.test(path));
    await assertPayerAccess(scope, payer, workflow, { configuration, external });
    return next();
  } catch (error) {
    return fail(res, error);
  }
}

/** Old invoice-claim ledger is manual, but must not bypass the same registry policy. */
export async function legacyClaimsGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const scope = await operationalScope(req);
    const input = body(req);
    requirePatientRead(req);
    if (req.method === 'GET') return next(); // Historical records remain readable.
    if (req.path === '/api/claims' && req.method === 'POST') {
      const invoice = await pool.query(
        `SELECT patient_id AS "patientId" FROM billing_invoices WHERE id=$1 AND tenant_id=$2 AND facility_id=$3`,
        [Number(input.invoiceId), scope.tenantId, scope.facilityId],
      );
      if (!invoice.rowCount)
        throw new PayerHubError('INVOICE_NOT_FOUND', 'Invoice not found in this facility.', 404);
      await patientIfSupplied(scope, invoice.rows[0].patientId);
      const payer = await assertPayerAccess(scope, input.payerCode, 'CLAIM_PREPARE');
      // The authoritative registered name, not caller-supplied free text.
      req.body.payerCode = payer.code;
      req.body.payerName = payer.displayName;
      return next();
    }
    const match = req.path.match(/^\/api\/claims\/(\d+)\/(submit|adjudicate|settle|status)$/);
    if (!match)
      throw new PayerHubError(
        'PAYER_OPERATION_UNCLASSIFIED',
        'Claim operation is not enabled by policy.',
        403,
      );
    const r = await pool.query(
      `SELECT c.payer_code AS "payerCode",c.payer_name AS "payerName" FROM insurance_claims c WHERE c.id=$1 AND c.tenant_id=$2 AND c.facility_id=$3`,
      [Number(match[1]), scope.tenantId, scope.facilityId],
    );
    if (!r.rowCount)
      throw new PayerHubError('CLAIM_NOT_FOUND', 'Claim not found in this facility.', 404);
    let payerCode = r.rows[0].payerCode as string | null;
    if (!payerCode) {
      // Exact legacy matches only; never guess an insurer from free text.
      const p = await pool.query(
        `SELECT code FROM insurance_payer_definitions WHERE upper(code)=upper($1) OR upper(display_name)=upper($1)`,
        [r.rows[0].payerName ?? ''],
      );
      if (p.rowCount === 1) payerCode = p.rows[0].code;
    }
    if (!payerCode)
      throw new PayerHubError(
        'LEGACY_PAYER_UNMAPPED',
        'This historical claim has no unambiguous registered payer; review it before further action.',
        409,
      );
    const action = match[2] === 'status' ? String(input.status ?? '') : match[2];
    const workflow: PayerWorkflow =
      action === 'submit' || action === 'Submitted'
        ? 'CLAIM_SUBMIT'
        : action === 'settle' || action === 'Settled'
          ? 'RECONCILIATION'
          : 'CLAIM_STATUS';
    await assertPayerAccess(scope, payerCode, workflow);
    if (
      workflow === 'CLAIM_SUBMIT' &&
      (typeof input.manualReference !== 'string' ||
        input.manualReference.trim().length < 3 ||
        input.manualReference.trim().length > 120)
    )
      throw new PayerHubError(
        'MANUAL_REFERENCE_REQUIRED',
        'Record the external manual dispatch reference before marking a claim submitted.',
      );
    return next();
  } catch (error) {
    return fail(res, error);
  }
}

/** Older DHA routes must not bypass SHA policy or patient/facility isolation. */
export async function dhaLegacyGuard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.path === '/readiness') return next(); // metadata-only platform page
    const scope = await operationalScope(req);
    if (
      req.path.startsWith('/patients/') ||
      req.path.startsWith('/invoices/') ||
      req.path === '/calls'
    )
      requirePatientRead(req);
    const patient = req.path.match(/^\/patients\/(\d+)\//);
    if (patient) await patientIfSupplied(scope, patient[1]);
    if (req.path.startsWith('/patients/')) {
      await assertPayerAccess(
        scope,
        'SHA',
        req.path.endsWith('/eligibility') ? 'ELIGIBILITY' : 'BENEFITS',
        { external: true },
      );
    } else if (req.method !== 'GET') await assertPayerAccess(scope, 'SHA', 'MAPPINGS');
    return next();
  } catch (error) {
    return fail(res, error);
  }
}
