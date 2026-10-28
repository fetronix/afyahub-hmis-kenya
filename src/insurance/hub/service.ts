import type { PoolClient } from 'pg';
import { pool } from '../../db/index.ts';

/** These are JaliCare workflow permissions, not provider API capabilities. */
export const PAYER_WORKFLOWS = [
  'CONFIGURE',
  'MEMBERSHIP',
  'ELIGIBILITY',
  'BENEFITS',
  'MAPPINGS',
  'PREAUTHORIZATION',
  'CLAIM_PREPARE',
  'CLAIM_SUBMIT',
  'CLAIM_STATUS',
  'RECONCILIATION',
] as const;
export type PayerWorkflow = (typeof PAYER_WORKFLOWS)[number];
export interface PayerScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}
export class PayerHubError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'PayerHubError';
  }
}
function id(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new PayerHubError('INVALID_ID', 'Invalid identifier.');
  return n;
}
function text(value: unknown, label: string, max = 120): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new PayerHubError('INVALID_INPUT', `${label} is required and must be valid.`);
  return value.trim();
}
function reference(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[A-Za-z0-9._:/-]+$/.test(result))
    throw new PayerHubError(
      'INVALID_REFERENCE',
      `${label} must be an opaque reference, not a secret.`,
    );
  return result;
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new PayerHubError('INVALID_INPUT', 'A boolean is required.');
  return value;
}
function code(value: unknown): string {
  const result = text(value, 'Payer code', 24).toUpperCase();
  if (!/^[A-Z0-9_]{2,24}$/.test(result))
    throw new PayerHubError('INVALID_PAYER_CODE', 'Invalid payer code.');
  return result;
}
function informationUrl(value: unknown): string {
  const raw = text(value, 'Information URL', 500);
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('invalid');
    return parsed.toString();
  } catch {
    throw new PayerHubError(
      'INVALID_URL',
      'Use an HTTPS information URL without credentials or query parameters.',
    );
  }
}
async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client: PoolClient,
  actor: number,
  scope: Partial<PayerScope>,
  action: string,
  resource: string,
  resourceId: number,
  details: object = {},
) {
  await client.query(
    `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope.tenantId ?? null,
      scope.facilityId ?? null,
      String(actor),
      action,
      `payer_hub.${resource}`,
      String(resourceId),
      JSON.stringify(details),
    ],
  );
}

/** Metadata only: no patient claims, facility credentials or financial data. */
export async function listPlatformPayers() {
  const [providers, policies, assignments, requests] = await Promise.all([
    pool.query(
      `SELECT id,code,display_name AS "displayName",payer_type AS "payerType",adapter_key AS "adapterKey",information_url AS "informationUrl",status,requestable FROM insurance_payer_definitions ORDER BY display_name`,
    ),
    pool.query(
      `SELECT provider_id AS "providerId",capability,is_allowed AS "isAllowed" FROM insurance_payer_capability_policies ORDER BY capability`,
    ),
    pool.query(
      `SELECT a.id,a.provider_id AS "providerId",a.tenant_id AS "tenantId",a.facility_id AS "facilityId",f.name AS "facilityName",a.is_allowed AS "isAllowed",a.assignment_source AS "assignmentSource",a.sandbox_status AS "sandboxStatus",a.production_approval AS "productionApproval" FROM insurance_payer_assignments a JOIN facilities f ON f.id=a.facility_id AND f.tenant_id=a.tenant_id ORDER BY f.name`,
    ),
    pool.query(
      `SELECT r.id,r.provider_id AS "providerId",r.facility_id AS "facilityId",f.name AS "facilityName",r.status,r.requested_at AS "requestedAt" FROM insurance_payer_access_requests r JOIN facilities f ON f.id=r.facility_id AND f.tenant_id=r.tenant_id WHERE r.status='PENDING' ORDER BY r.requested_at DESC`,
    ),
  ]);
  return {
    providers: providers.rows.map((p) => ({
      ...p,
      capabilities: policies.rows.filter((c) => c.providerId === p.id),
    })),
    assignments: assignments.rows,
    requests: requests.rows,
    notice:
      'Workflow policies control internal/manual processing. They do not establish an API contract, connection, sandbox verification or production approval.',
  };
}
export async function listPlatformFacilities() {
  return (
    await pool.query(
      `SELECT id,tenant_id AS "tenantId",name FROM facilities WHERE is_active IS NOT FALSE ORDER BY name`,
    )
  ).rows;
}
export async function registerPayer(actor: number, input: Record<string, unknown>) {
  const payerCode = code(input.code);
  const name = text(input.displayName, 'Display name');
  const url = informationUrl(input.informationUrl);
  if (input.adapterKey !== undefined || input.status !== undefined || input.payerType !== undefined)
    throw new PayerHubError(
      'PLATFORM_ADAPTER_IMMUTABLE',
      'New payers start as disabled, manual-only private insurers.',
    );
  return transaction(async (c) => {
    const result = await c.query(
      `INSERT INTO insurance_payer_definitions(code,display_name,payer_type,adapter_key,information_url,status) VALUES($1,$2,'PRIVATE_INSURER','manual',$3,'DISABLED') ON CONFLICT (code) DO NOTHING RETURNING id,code`,
      [payerCode, name, url],
    );
    if (!result.rowCount)
      throw new PayerHubError('PAYER_EXISTS', 'That payer code is already registered.', 409);
    const providerId = result.rows[0].id as number;
    for (const capability of PAYER_WORKFLOWS)
      await c.query(
        `INSERT INTO insurance_payer_capability_policies(provider_id,capability,is_allowed) VALUES($1,$2,true)`,
        [providerId, capability],
      );
    await audit(c, actor, {}, 'CREATE', 'provider', providerId, {
      code: payerCode,
      adapter: 'manual',
      status: 'DISABLED',
    });
    return result.rows[0];
  });
}
export async function updatePayer(
  actor: number,
  providerId: number,
  input: Record<string, unknown>,
) {
  const allowed = new Set(['status', 'requestable']);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new PayerHubError(
      'PLATFORM_ADAPTER_IMMUTABLE',
      'Provider identity and adapter are code-owned.',
    );
  if (input.status !== undefined && input.status !== 'ACTIVE' && input.status !== 'DISABLED')
    throw new PayerHubError('INVALID_STATUS', 'Choose ACTIVE or DISABLED.');
  if (input.requestable !== undefined) flag(input.requestable);
  return transaction(async (c) => {
    const r = await c.query(
      `UPDATE insurance_payer_definitions SET status=COALESCE($2,status),requestable=COALESCE($3,requestable),updated_at=now() WHERE id=$1 RETURNING id,code,status,requestable`,
      [id(providerId), input.status ?? null, input.requestable ?? null],
    );
    if (!r.rowCount) throw new PayerHubError('PAYER_NOT_FOUND', 'Payer not found.', 404);
    await audit(c, actor, {}, 'UPDATE', 'provider', providerId, {
      status: r.rows[0].status,
      requestable: r.rows[0].requestable,
    });
    return r.rows[0];
  });
}
export async function updateCapability(
  actor: number,
  providerId: number,
  workflow: string,
  allowed: unknown,
) {
  if (!PAYER_WORKFLOWS.includes(workflow as PayerWorkflow))
    throw new PayerHubError('UNKNOWN_WORKFLOW', 'Workflow is not implemented.');
  const isAllowed = flag(allowed);
  return transaction(async (c) => {
    const r = await c.query(
      `UPDATE insurance_payer_capability_policies SET is_allowed=$3 WHERE provider_id=$1 AND capability=$2 RETURNING id`,
      [id(providerId), workflow, isAllowed],
    );
    if (!r.rowCount)
      throw new PayerHubError('PAYER_NOT_FOUND', 'Payer or workflow not found.', 404);
    await audit(c, actor, {}, 'UPDATE', 'workflow_policy', providerId, { workflow, isAllowed });
    return { providerId, workflow, isAllowed };
  });
}
export async function assignPayer(
  actor: number,
  providerId: number,
  facilityId: number,
  allowed: unknown,
) {
  const isAllowed = flag(allowed);
  return transaction(async (c) => {
    const f = await c.query(`SELECT id,tenant_id AS "tenantId" FROM facilities WHERE id=$1`, [
      id(facilityId),
    ]);
    const p = await c.query(`SELECT id,status FROM insurance_payer_definitions WHERE id=$1`, [
      id(providerId),
    ]);
    if (!f.rowCount || !p.rowCount)
      throw new PayerHubError('NOT_FOUND', 'Payer or facility not found.', 404);
    if (isAllowed && p.rows[0].status !== 'ACTIVE')
      throw new PayerHubError('PAYER_DISABLED', 'A disabled payer cannot be assigned.', 409);
    const s = { tenantId: f.rows[0].tenantId as number, facilityId };
    const a = await c.query(
      `INSERT INTO insurance_payer_assignments(provider_id,tenant_id,facility_id,is_allowed,assignment_source,updated_by_user_id) VALUES($1,$2,$3,$4,'PLATFORM',$5)
      ON CONFLICT(provider_id,facility_id) DO UPDATE SET is_allowed=EXCLUDED.is_allowed,assignment_source='PLATFORM',updated_by_user_id=$5,updated_at=now()
      RETURNING id,provider_id AS "providerId",facility_id AS "facilityId",is_allowed AS "isAllowed"`,
      [providerId, s.tenantId, facilityId, isAllowed, actor],
    );
    if (isAllowed)
      await c.query(
        `UPDATE insurance_payer_access_requests SET status='GRANTED' WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3`,
        [providerId, s.tenantId, facilityId],
      );
    await audit(c, actor, s, 'ASSIGN', 'assignment', a.rows[0].id, { providerId, isAllowed });
    return a.rows[0];
  });
}

export async function facilityCatalogue(scope: PayerScope) {
  const r = await pool.query(
    `SELECT p.id,p.code,p.display_name AS "displayName",p.payer_type AS "payerType",p.adapter_key AS "adapterKey",p.information_url AS "informationUrl",p.status,p.requestable,
    COALESCE(a.is_allowed,false) AS "isAssigned",a.assignment_source AS "assignmentSource",COALESCE(a.sandbox_status,'NOT_TESTED') AS "sandboxStatus",COALESCE(a.production_approval,'NOT_REQUESTED') AS "productionApproval",
    COALESCE(r.status,'NOT_REQUESTED') AS "requestStatus",c.id AS "configId",COALESCE(c.is_active,false) AS "isActive",c.integration_type AS "integrationType",
    COALESCE(json_agg(cp.capability ORDER BY cp.capability) FILTER (WHERE cp.is_allowed AND p.status='ACTIVE' AND a.is_allowed AND c.is_active),'[]') AS workflows
    FROM insurance_payer_definitions p
    LEFT JOIN insurance_payer_assignments a ON a.provider_id=p.id AND a.tenant_id=$1 AND a.facility_id=$2
    LEFT JOIN insurance_payer_access_requests r ON r.provider_id=p.id AND r.tenant_id=$1 AND r.facility_id=$2
    LEFT JOIN insurance_payer_configs c ON c.payer_code=p.code AND c.tenant_id=$1 AND c.facility_id=$2
    LEFT JOIN insurance_payer_capability_policies cp ON cp.provider_id=p.id
    WHERE (p.status='ACTIVE' AND p.requestable) OR a.id IS NOT NULL
    GROUP BY p.id,a.id,r.id,c.id ORDER BY p.display_name`,
    [scope.tenantId, scope.facilityId],
  );
  const environments = await pool.query(
    `SELECT provider_id AS "providerId",environment,secret_env_prefix AS "secretEnvPrefix",provider_identifier AS "providerIdentifier" FROM insurance_payer_environment_configs WHERE tenant_id=$1 AND facility_id=$2`,
    [scope.tenantId, scope.facilityId],
  );
  return {
    providers: r.rows.map((p) => ({
      ...p,
      usableForNewClaims:
        p.status === 'ACTIVE' &&
        p.isAssigned &&
        p.isActive &&
        p.workflows.includes('CLAIM_PREPARE'),
      connectionStatus: 'NOT_VERIFIED',
      processing:
        p.code === 'SHA'
          ? 'Internal/manual workflows; external transport and operational simulation blocked'
          : 'Manual internal processing; no authorized live API',
      environments: environments.rows
        .filter((e) => e.providerId === p.id)
        .map((e) => ({
          environment: e.environment,
          secretReference: e.secretEnvPrefix,
          providerIdentifier: e.providerIdentifier,
          configured: Boolean(
            process.env[`${e.secretEnvPrefix}_CLIENT_ID`] &&
            process.env[`${e.secretEnvPrefix}_CLIENT_SECRET`],
          ),
          connectionVerified: false,
        })),
    })),
    notice:
      'Registration and manual processing do not mean a payer API is connected. Sandbox and production have not been verified.',
  };
}
export async function requestAccess(scope: PayerScope, providerId: number) {
  return transaction(async (c) => {
    const p = await c.query(
      `SELECT id FROM insurance_payer_definitions WHERE id=$1 AND status='ACTIVE' AND requestable=true`,
      [id(providerId)],
    );
    if (!p.rowCount)
      throw new PayerHubError(
        'PAYER_NOT_REQUESTABLE',
        'This payer is not available for requests.',
        404,
      );
    const a = await c.query(
      `SELECT is_allowed FROM insurance_payer_assignments WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3`,
      [providerId, scope.tenantId, scope.facilityId],
    );
    if (a.rows[0]?.is_allowed)
      throw new PayerHubError('ALREADY_ASSIGNED', 'This payer is already assigned.', 409);
    const r = await c.query(
      `INSERT INTO insurance_payer_access_requests(provider_id,tenant_id,facility_id,requested_by_user_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(provider_id,facility_id) DO UPDATE SET status='PENDING',requested_by_user_id=$4,requested_at=now() RETURNING id,status`,
      [providerId, scope.tenantId, scope.facilityId, scope.actorUserId],
    );
    await audit(c, scope.actorUserId, scope, 'REQUEST', 'access', r.rows[0].id, { providerId });
    return r.rows[0];
  });
}
/** Check registration, global status, assignment, workflow policy and facility activation on the server. */
export async function assertPayerAccess(
  scope: Pick<PayerScope, 'tenantId' | 'facilityId'>,
  payerCode: unknown,
  workflow: PayerWorkflow,
  options: { configuration?: boolean; external?: boolean } = {},
) {
  const payer = code(payerCode);
  const r = await pool.query(
    `SELECT p.id,p.code,p.display_name AS "displayName",p.adapter_key AS "adapterKey",p.status,a.is_allowed AS "isAssigned",cp.is_allowed AS "workflowAllowed",c.id AS "configId",c.is_active AS "isActive",c.environment,c.adapter_key AS "facilityAdapterKey",c.integration_type AS "integrationType"
    FROM insurance_payer_definitions p
    LEFT JOIN insurance_payer_assignments a ON a.provider_id=p.id AND a.tenant_id=$2 AND a.facility_id=$3
    LEFT JOIN insurance_payer_capability_policies cp ON cp.provider_id=p.id AND cp.capability=$4
    LEFT JOIN insurance_payer_configs c ON c.payer_code=p.code AND c.tenant_id=$2 AND c.facility_id=$3
    WHERE p.code=$1`,
    [payer, scope.tenantId, scope.facilityId, workflow],
  );
  const row = r.rows[0];
  if (!row)
    throw new PayerHubError(
      'PAYER_NOT_REGISTERED',
      'Payer is not registered on the platform.',
      403,
    );
  if (row.status !== 'ACTIVE')
    throw new PayerHubError('PAYER_DISABLED', 'This payer is disabled globally.', 403);
  if (!row.isAssigned)
    throw new PayerHubError(
      'PAYER_NOT_ASSIGNED',
      'This payer is not assigned to this facility.',
      403,
    );
  if (!row.workflowAllowed)
    throw new PayerHubError(
      'PAYER_WORKFLOW_DISABLED',
      'This payer workflow is disabled by platform policy.',
      403,
    );
  if (!options.configuration && (!row.configId || !row.isActive))
    throw new PayerHubError(
      'PAYER_INACTIVE',
      'Activate and configure this payer for the facility before starting a workflow.',
      403,
    );
  if (!options.configuration && row.environment === 'PRODUCTION')
    throw new PayerHubError(
      'PAYER_PRODUCTION_BLOCKED',
      'Production transport is not approved or verified.',
      403,
    );
  if (!options.configuration && payer !== 'SHA' && row.facilityAdapterKey !== row.adapterKey)
    throw new PayerHubError(
      'PAYER_ADAPTER_MISMATCH',
      'Legacy adapter settings require facility review.',
      403,
    );
  if (
    !options.configuration &&
    payer !== 'SHA' &&
    !['MANUAL', 'FILE_EXPORT'].includes(row.integrationType)
  )
    throw new PayerHubError(
      'LIVE_ADAPTER_UNAVAILABLE',
      'Only manual or file processing is available for this payer.',
      403,
    );
  // The legacy SHA transport uses process-wide credentials. Until isolated
  // facility credentials and provider authorization are wired, never dispatch it.
  if (options.external && payer === 'SHA')
    throw new PayerHubError(
      'SHA_TRANSPORT_BLOCKED',
      'SHA/DHA transport is unavailable in the operational application. Mock adapters are for isolated tests only; live use requires facility-isolated credentials, contract review and sandbox verification.',
      403,
    );
  if (options.external && payer !== 'SHA')
    throw new PayerHubError(
      'PAYER_TRANSPORT_BLOCKED',
      'No private payer transport is authorized or verified; use a documented manual workflow.',
      403,
    );
  return row;
}
export async function setActivation(scope: PayerScope, providerId: number, enabled: unknown) {
  const isActive = flag(enabled);
  const p = await pool.query(
    `SELECT id,code,display_name AS "displayName",payer_type AS "payerType",adapter_key AS "adapterKey" FROM insurance_payer_definitions WHERE id=$1`,
    [id(providerId)],
  );
  if (!p.rowCount) throw new PayerHubError('PAYER_NOT_FOUND', 'Payer not found.', 404);
  const provider = p.rows[0];
  if (isActive) await assertPayerAccess(scope, provider.code, 'CONFIGURE', { configuration: true });
  return transaction(async (c) => {
    if (!isActive) {
      const updated = await c.query(
        `UPDATE insurance_payer_configs SET is_active=false,updated_by_user_id=$4,updated_at=now() WHERE tenant_id=$1 AND facility_id=$2 AND payer_code=$3 RETURNING id`,
        [scope.tenantId, scope.facilityId, provider.code, scope.actorUserId],
      );
      if (!updated.rowCount)
        throw new PayerHubError(
          'PAYER_NOT_CONFIGURED',
          'Payer is not configured for this facility.',
          404,
        );
      await audit(c, scope.actorUserId, scope, 'DISABLE', 'facility_config', updated.rows[0].id, {
        providerId,
      });
      return { isActive: false };
    }
    const updated = await c.query(
      `INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type,integration_type,adapter_key,environment,connection_status,auth_method,contracted_schemes,default_coding_system,claim_requirements,preauth_requirements,is_active,updated_by_user_id)
      VALUES($1,$2,$3,$4,$5,'MANUAL',$6,'UNCONFIGURED','NOT_CONFIGURED','NONE','[]'::jsonb,$7,'{"codingPolicyVerified":false,"allowedCodingSystems":[]}'::jsonb,'{}'::jsonb,true,$8)
      ON CONFLICT(facility_id,payer_code) DO UPDATE SET is_active=true,updated_by_user_id=$8,updated_at=now()
      WHERE insurance_payer_configs.tenant_id=$1 RETURNING id`,
      [
        scope.tenantId,
        scope.facilityId,
        provider.code,
        provider.displayName,
        provider.payerType,
        provider.adapterKey,
        provider.code === 'SHA' ? 'ICD-11' : 'ICD-10',
        scope.actorUserId,
      ],
    );
    if (!updated.rowCount)
      throw new PayerHubError(
        'PAYER_CONFIG_SCOPE_MISMATCH',
        'Facility payer configuration mismatch.',
        403,
      );
    await audit(c, scope.actorUserId, scope, 'ENABLE', 'facility_config', updated.rows[0].id, {
      providerId,
    });
    return { isActive: true, configId: updated.rows[0].id };
  });
}
/** Only deterministic, facility/environment-owned environment references are accepted. */
export async function configureEnvironment(
  scope: PayerScope,
  providerId: number,
  environment: string,
  input: Record<string, unknown>,
) {
  if (environment !== 'SANDBOX' && environment !== 'PRODUCTION')
    throw new PayerHubError('INVALID_ENVIRONMENT', 'Choose SANDBOX or PRODUCTION.');
  if (Object.keys(input).some((key) => key !== 'providerIdentifier' && key !== 'facilityId'))
    throw new PayerHubError(
      'RAW_SECRET_FORBIDDEN',
      'Only a provider identifier may be submitted. Secrets must be provisioned server-side.',
    );
  const p = await pool.query(`SELECT code FROM insurance_payer_definitions WHERE id=$1`, [
    id(providerId),
  ]);
  if (!p.rowCount) throw new PayerHubError('PAYER_NOT_FOUND', 'Payer not found.', 404);
  await assertPayerAccess(scope, p.rows[0].code, 'CONFIGURE', { configuration: true });
  const prefix = `PAYER_HUB_T${scope.tenantId}_F${scope.facilityId}_${p.rows[0].code}_${environment}`;
  const identifier = input.providerIdentifier
    ? reference(input.providerIdentifier, 'Provider identifier')
    : null;
  return transaction(async (c) => {
    const r = await c.query(
      `INSERT INTO insurance_payer_environment_configs(provider_id,tenant_id,facility_id,environment,secret_env_prefix,provider_identifier,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(provider_id,facility_id,environment) DO UPDATE SET provider_identifier=$6,updated_by_user_id=$7,updated_at=now() RETURNING id`,
      [
        providerId,
        scope.tenantId,
        scope.facilityId,
        environment,
        prefix,
        identifier,
        scope.actorUserId,
      ],
    );
    await audit(c, scope.actorUserId, scope, 'CONFIGURE', 'environment', r.rows[0].id, {
      providerId,
      environment,
    });
    return {
      environment,
      secretReference: prefix,
      connectionVerified: false,
      notice: 'Reference only; credentials have not been tested or authorized for use.',
    };
  });
}
export async function requestProduction(scope: PayerScope, providerId: number) {
  const p = await pool.query(`SELECT code FROM insurance_payer_definitions WHERE id=$1`, [
    id(providerId),
  ]);
  if (!p.rowCount) throw new PayerHubError('PAYER_NOT_FOUND', 'Payer not found.', 404);
  await assertPayerAccess(scope, p.rows[0].code, 'CONFIGURE', { configuration: true });
  return transaction(async (c) => {
    const r = await c.query(
      `UPDATE insurance_payer_assignments SET production_approval='PENDING',production_requested_by_user_id=$4,production_decided_by_user_id=NULL,approval_reference=NULL,updated_at=now() WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3 RETURNING id`,
      [providerId, scope.tenantId, scope.facilityId, scope.actorUserId],
    );
    await audit(c, scope.actorUserId, scope, 'REQUEST', 'production_approval', r.rows[0].id, {
      providerId,
    });
    return { productionApproval: 'PENDING' };
  });
}
export async function decideProduction(
  actor: number,
  assignmentId: number,
  input: Record<string, unknown>,
) {
  const decision = input.decision;
  if (decision !== 'APPROVED' && decision !== 'REJECTED')
    throw new PayerHubError('INVALID_DECISION', 'Choose APPROVED or REJECTED.');
  const evidence = reference(input.reference, 'Decision reference');
  return transaction(async (c) => {
    const r = await c.query(
      `SELECT id,tenant_id AS "tenantId",facility_id AS "facilityId",provider_id AS "providerId",sandbox_status AS "sandboxStatus",production_approval AS "productionApproval" FROM insurance_payer_assignments WHERE id=$1 FOR UPDATE`,
      [id(assignmentId)],
    );
    if (!r.rowCount) throw new PayerHubError('ASSIGNMENT_NOT_FOUND', 'Assignment not found.', 404);
    const a = r.rows[0];
    if (a.productionApproval !== 'PENDING')
      throw new PayerHubError('APPROVAL_NOT_PENDING', 'A production request must be pending.', 409);
    // There is currently no validated, facility-isolated payer transport.
    // Recording a self-attestation is not sandbox verification.
    if (decision === 'APPROVED')
      throw new PayerHubError(
        'PRODUCTION_BLOCKED',
        'No facility-isolated payer transport has passed authorized sandbox and security verification.',
        409,
      );
    await c.query(
      `UPDATE insurance_payer_assignments SET production_approval=$2,approval_reference=$3,production_decided_by_user_id=$4,updated_at=now() WHERE id=$1`,
      [assignmentId, decision, evidence, actor],
    );
    await audit(c, actor, a, 'DECIDE', 'production_approval', assignmentId, {
      providerId: a.providerId,
      decision,
    });
    return { productionApproval: decision };
  });
}

/** Find a patient only if registered at or previously seen in this facility. */
export async function facilityPatient(tenantId: number, facilityId: number, patientId: number) {
  const r = await pool.query(
    `SELECT p.* FROM patients p WHERE p.id=$1 AND p.tenant_id=$2 AND (p.registration_facility_id=$3 OR EXISTS (SELECT 1 FROM patient_facilities pf WHERE pf.patient_id=p.id AND pf.tenant_id=$2 AND pf.facility_id=$3 AND pf.status='ACTIVE') OR EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id=p.id AND e.tenant_id=$2 AND e.facility_id=$3))`,
    [id(patientId), tenantId, facilityId],
  );
  return r.rows[0] ?? null;
}
