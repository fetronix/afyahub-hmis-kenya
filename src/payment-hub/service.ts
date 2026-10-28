import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { parseMoneyToCents } from '../billing/settlement.ts';
import { PaymentHubError } from './errors.ts';
import { providerBoundary } from './adapters/index.ts';
import { validateDarajaCredentials } from './adapters/daraja.ts';
import type { Capability } from './adapters/contracts.ts';
import { decryptFacilitySecret, encryptFacilitySecret, privateDigest } from './secrets.ts';

export interface HubScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}
const CREDENTIAL_MASK = 'Reference configured (secret hidden)';
function credentialVariable(scope: HubScope, integrationId: number, env: string): string {
  return `PAYMENT_HUB_T${scope.tenantId}_F${scope.facilityId}_I${integrationId}_${env}`;
}
function darajaEnvironmentCredentials(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw)
    throw new PaymentHubError(
      'CREDENTIALS_REQUIRED',
      'The facility-specific server environment secret is not provisioned.',
      409,
    );
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return { ...validateDarajaCredentials(parsed as Record<string, unknown>) };
  } catch {
    throw new PaymentHubError(
      'INVALID_CREDENTIAL_CONFIGURATION',
      'The facility-specific server environment secret is invalid.',
      503,
    );
  }
}
function credentialFingerprint(credentials: Record<string, string>): string {
  return privateDigest(`daraja-material:${JSON.stringify(credentials)}`);
}
function numberId(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new PaymentHubError('INVALID_ID', 'A valid identifier is required.');
  return n;
}
function stringField(value: unknown, label: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    throw new PaymentHubError('INVALID_INPUT', `${label} is required and must be valid.`);
  return value.trim();
}
function reference(value: unknown, label = 'Reference'): string {
  const result = stringField(value, label, 120);
  if (!/^[A-Za-z0-9._:/-]+$/.test(result))
    throw new PaymentHubError(
      'INVALID_INPUT',
      `${label} may contain only letters, numbers and . _ : / -.`,
    );
  return result;
}
function environment(value: unknown): 'SANDBOX' | 'PRODUCTION' {
  if (value !== 'SANDBOX' && value !== 'PRODUCTION')
    throw new PaymentHubError('INVALID_ENVIRONMENT', 'Choose sandbox or production.');
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new PaymentHubError('INVALID_INPUT', 'A boolean setting is required.');
  return value;
}
async function tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
async function audit(
  c: PoolClient,
  actorUserId: number,
  scope: { tenantId?: number | null; facilityId?: number | null },
  action: string,
  resource: string,
  resourceId: number,
  details: object = {},
) {
  await c.query(
    `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope.tenantId ?? null,
      scope.facilityId ?? null,
      String(actorUserId),
      action,
      `payment_hub.${resource}`,
      String(resourceId),
      JSON.stringify(details),
    ],
  );
}
function url(value: unknown): string {
  const text = stringField(value, 'Documentation URL', 500);
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
      throw new Error('invalid');
    return u.toString();
  } catch {
    throw new PaymentHubError(
      'INVALID_URL',
      'Use an HTTPS documentation URL without credentials or query parameters.',
    );
  }
}

/** Platform-only metadata: never select secrets, account identifiers, amounts or transaction references. */
export async function listPlatformHub() {
  const [providers, envs, policies, assignments, requests, audits] = await Promise.all([
    pool.query(`SELECT p.id,p.code,p.display_name AS "displayName",p.adapter_key AS "adapterKey",p.documentation_url AS "documentationUrl",p.description,p.status,p.requestable,
      (SELECT count(*)::int FROM payment_provider_assignments a WHERE a.provider_id=p.id AND a.is_allowed) AS "assignedFacilities",
      (SELECT count(*)::int FROM facility_payment_integrations i WHERE i.provider_id=p.id AND i.is_enabled) AS "enabledIntegrations",
      (SELECT count(*)::int FROM facility_payment_integrations i WHERE i.provider_id=p.id AND i.connection_status='UNAVAILABLE') AS "unavailableIntegrations"
      FROM payment_provider_definitions p ORDER BY p.display_name`),
    pool.query(
      `SELECT provider_id AS "providerId",environment,is_available AS "isAvailable",(shared_secret_reference IS NOT NULL) AS "sharedReferenceConfigured",(shared_contract_reference IS NOT NULL) AS "sharedContractRecorded" FROM payment_provider_environments ORDER BY provider_id,environment`,
    ),
    pool.query(
      'SELECT provider_id AS "providerId",capability,is_allowed AS "isAllowed" FROM payment_provider_capability_policies',
    ),
    pool.query(`SELECT a.provider_id AS "providerId",a.facility_id AS "facilityId",f.name AS "facilityName",a.tenant_id AS "tenantId",a.is_allowed AS "isAllowed",a.shared_credentials_allowed AS "sharedCredentialsAllowed",
      COALESCE(json_agg(json_build_object('id',i.id,'environment',i.environment,'enabled',i.is_enabled,'connectionStatus',i.connection_status,'productionApproval',i.production_approval,'lastHealthAt',i.last_health_at)) FILTER(WHERE i.id IS NOT NULL),'[]') AS integrations
      FROM payment_provider_assignments a JOIN facilities f ON f.id=a.facility_id AND f.tenant_id=a.tenant_id
      LEFT JOIN facility_payment_integrations i ON i.provider_id=a.provider_id AND i.facility_id=a.facility_id AND i.tenant_id=a.tenant_id
      GROUP BY a.id,f.name ORDER BY f.name,a.provider_id`),
    pool.query(
      `SELECT r.provider_id AS "providerId",r.facility_id AS "facilityId",f.name AS "facilityName",r.status,r.requested_at AS "requestedAt" FROM payment_provider_access_requests r JOIN facilities f ON f.id=r.facility_id AND f.tenant_id=r.tenant_id WHERE r.status='PENDING' ORDER BY r.requested_at DESC`,
    ),
    pool.query(
      `SELECT id,tenant_id AS "tenantId",facility_id AS "facilityId",user_id AS "actorUserId",action,resource,resource_id AS "resourceId",timestamp FROM audit_logs WHERE resource LIKE 'payment_hub.%' ORDER BY id DESC LIMIT 100`,
    ),
  ]);
  return {
    providers: providers.rows.map((p) => ({
      ...p,
      adapter: providerBoundary(p.adapterKey).descriptor,
      capabilities: providerBoundary(p.adapterKey).descriptor.implementedCapabilities.map(
        (capability) => ({
          capability,
          isAllowed: policies.rows.some(
            (policy) =>
              policy.providerId === p.id && policy.capability === capability && policy.isAllowed,
          ),
        }),
      ),
      environments: envs.rows.filter((e) => e.providerId === p.id),
    })),
    assignments: assignments.rows,
    requests: requests.rows,
    auditEvents: audits.rows,
    notice:
      'Provider metadata only. Facility credentials, balances, statements and transactions are not available from this platform view.',
  };
}
export async function listPlatformFacilities() {
  const result = await pool.query(
    'SELECT id,tenant_id AS "tenantId",name FROM facilities ORDER BY name LIMIT 1000',
  );
  return result.rows;
}
export async function registerProvider(actor: number, input: Record<string, unknown>) {
  const code = stringField(input.code, 'Provider code', 40).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(code))
    throw new PaymentHubError(
      'INVALID_INPUT',
      'Provider code must contain uppercase letters, digits and underscores.',
    );
  const name = stringField(input.displayName, 'Provider name', 120),
    docs = url(input.documentationUrl),
    description = stringField(input.description, 'Description', 500);
  try {
    return await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO payment_provider_definitions(code,display_name,adapter_key,documentation_url,description,status,requestable) VALUES($1,$2,'UNCONFIGURED',$3,$4,'DISABLED',false) RETURNING id`,
        [code, name, docs, description],
      );
      await c.query(
        `INSERT INTO payment_provider_environments(provider_id,environment) VALUES($1,'SANDBOX'),($1,'PRODUCTION')`,
        [r.rows[0].id],
      );
      await audit(c, actor, {}, 'CREATE', 'provider', r.rows[0].id, { adapter: 'UNCONFIGURED' });
      return { id: r.rows[0].id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new PaymentHubError('PROVIDER_EXISTS', 'Provider code already exists.', 409);
    throw error;
  }
}
export async function updateProvider(
  actor: number,
  providerId: number,
  input: Record<string, unknown>,
) {
  numberId(providerId);
  const status = input.status;
  if (status !== 'ACTIVE' && status !== 'DISABLED')
    throw new PaymentHubError('INVALID_INPUT', 'Choose ACTIVE or DISABLED.');
  const requestable = bool(input.requestable);
  const name =
    input.displayName === undefined ? null : stringField(input.displayName, 'Provider name', 120);
  const docs = input.documentationUrl === undefined ? null : url(input.documentationUrl);
  const description =
    input.description === undefined ? null : stringField(input.description, 'Description', 500);
  return tx(async (c) => {
    const p = await c.query(
      'UPDATE payment_provider_definitions SET status=$1,requestable=$2,display_name=COALESCE($3,display_name),documentation_url=COALESCE($4,documentation_url),description=COALESCE($5,description),updated_at=now() WHERE id=$6 RETURNING id',
      [status, requestable, name, docs, description, providerId],
    );
    if (!p.rows.length) throw new PaymentHubError('PROVIDER_NOT_FOUND', 'Provider not found.', 404);
    await audit(c, actor, {}, 'UPDATE', 'provider', providerId, { status, requestable });
    return { id: providerId, status, requestable };
  });
}
export async function updateProviderEnvironment(
  actor: number,
  providerId: number,
  env: unknown,
  input: Record<string, unknown>,
) {
  numberId(providerId);
  const selected = environment(env),
    available = bool(input.isAvailable);
  return tx(async (c) => {
    const existing = await c.query(
      'SELECT id,shared_secret_reference,shared_contract_reference FROM payment_provider_environments WHERE provider_id=$1 AND environment=$2 FOR UPDATE',
      [providerId, selected],
    );
    if (!existing.rows.length)
      throw new PaymentHubError('PROVIDER_NOT_FOUND', 'Provider environment not found.', 404);
    let secretRef: string | null = existing.rows[0].shared_secret_reference,
      contractRef: string | null = existing.rows[0].shared_contract_reference;
    if (Object.prototype.hasOwnProperty.call(input, 'sharedSecretReference')) {
      if (input.sharedSecretReference === null || input.sharedSecretReference === '') {
        secretRef = null;
        contractRef = null;
      } else {
        secretRef = stringField(input.sharedSecretReference, 'Shared secret reference', 100);
        if (!/^env:PAYMENT_HUB_SHARED_[A-Z0-9_]+$/.test(secretRef))
          throw new PaymentHubError(
            'INVALID_INPUT',
            'Shared reference must name an approved PAYMENT_HUB_SHARED_ environment variable, not a secret.',
          );
        contractRef = reference(input.sharedContractReference, 'Provider contract reference');
      }
    }
    const r = await c.query(
      'UPDATE payment_provider_environments SET is_available=$1,shared_secret_reference=$2,shared_contract_reference=$3 WHERE id=$4 RETURNING id',
      [available, secretRef, contractRef, existing.rows[0].id],
    );
    await audit(c, actor, {}, 'UPDATE', 'environment', r.rows[0].id, {
      environment: selected,
      available,
      sharedReferenceConfigured: Boolean(secretRef),
    });
    return {
      id: r.rows[0].id,
      isAvailable: available,
      sharedReferenceConfigured: Boolean(secretRef),
      sharedUseOperational: false,
    };
  });
}
/** Global policy can only restrict capabilities already implemented by code. */
export async function updateProviderCapability(
  actor: number,
  providerId: number,
  capability: unknown,
  input: Record<string, unknown>,
) {
  numberId(providerId);
  const name = stringField(capability, 'Capability', 60);
  const allowed = bool(input.isAllowed);
  return tx(async (c) => {
    const result = await c.query(
      'SELECT adapter_key FROM payment_provider_definitions WHERE id=$1 FOR UPDATE',
      [providerId],
    );
    if (!result.rows.length)
      throw new PaymentHubError('PROVIDER_NOT_FOUND', 'Provider not found.', 404);
    const descriptor = providerBoundary(result.rows[0].adapter_key).descriptor;
    if (!descriptor.implementedCapabilities.includes(name as Capability) || name === 'TRANSFER')
      throw new PaymentHubError(
        'CAPABILITY_UNAVAILABLE',
        'The adapter does not implement this capability.',
        403,
      );
    const existing = await c.query(
      'SELECT is_allowed FROM payment_provider_capability_policies WHERE provider_id=$1 AND capability=$2 FOR UPDATE',
      [providerId, name],
    );
    if (!existing.rows.length || existing.rows[0].is_allowed !== allowed) {
      await c.query(
        `INSERT INTO payment_provider_capability_policies(provider_id,capability,is_allowed) VALUES($1,$2,$3)
        ON CONFLICT(provider_id,capability) DO UPDATE SET is_allowed=EXCLUDED.is_allowed`,
        [providerId, name, allowed],
      );
      // Previously approved/enabled configurations must be reviewed again.
      await c.query(
        `UPDATE facility_payment_integrations SET is_enabled=false,production_approval='NOT_REQUESTED',approval_reference=NULL,approved_by_user_id=NULL,approved_at=NULL,revision=revision+1,updated_at=now()
        WHERE provider_id=$1 AND $2=ANY(enabled_capabilities)`,
        [providerId, name],
      );
    }
    await audit(c, actor, {}, 'UPDATE', 'capability', providerId, {
      capability: name,
      isAllowed: allowed,
    });
    return { providerId, capability: name, isAllowed: allowed };
  });
}
async function requireAllowedCapabilities(
  c: PoolClient,
  providerId: number,
  capabilities: string[],
) {
  if (!capabilities.length) return;
  const result = await c.query(
    'SELECT capability,is_allowed FROM payment_provider_capability_policies WHERE provider_id=$1 AND capability=ANY($2::text[])',
    [providerId, capabilities],
  );
  if (result.rows.length !== capabilities.length || result.rows.some((row) => !row.is_allowed))
    throw new PaymentHubError(
      'CAPABILITY_RESTRICTED',
      'A selected capability is restricted by platform policy.',
      403,
    );
}
export async function assignProvider(
  actor: number,
  providerId: number,
  facilityId: number,
  input: Record<string, unknown>,
) {
  numberId(providerId);
  numberId(facilityId);
  const allowed = bool(input.isAllowed);
  const shared =
    input.sharedCredentialsAllowed === undefined ? false : bool(input.sharedCredentialsAllowed);
  return tx(async (c) => {
    const f = await c.query('SELECT id,tenant_id FROM facilities WHERE id=$1', [facilityId]);
    const p = await c.query('SELECT id FROM payment_provider_definitions WHERE id=$1', [
      providerId,
    ]);
    if (!f.rows.length || !p.rows.length)
      throw new PaymentHubError('NOT_FOUND', 'Provider or facility not found.', 404);
    if (shared) {
      const proof = await c.query(
        'SELECT 1 FROM payment_provider_environments WHERE provider_id=$1 AND shared_secret_reference IS NOT NULL AND shared_contract_reference IS NOT NULL',
        [providerId],
      );
      if (!proof.rows.length)
        throw new PaymentHubError(
          'SHARED_CONTRACT_REQUIRED',
          'Record the provider contract and secret reference first.',
          409,
        );
    }
    const row = await c.query(
      `INSERT INTO payment_provider_assignments(provider_id,tenant_id,facility_id,is_allowed,shared_credentials_allowed,updated_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_id,facility_id) DO UPDATE SET is_allowed=EXCLUDED.is_allowed,shared_credentials_allowed=EXCLUDED.shared_credentials_allowed,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now() RETURNING id`,
      [providerId, f.rows[0].tenant_id, facilityId, allowed, shared, actor],
    );
    if (allowed)
      await c.query(
        `UPDATE payment_provider_access_requests SET status='GRANTED' WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3`,
        [providerId, f.rows[0].tenant_id, facilityId],
      );
    await audit(
      c,
      actor,
      { tenantId: f.rows[0].tenant_id, facilityId },
      allowed ? 'ASSIGN' : 'REVOKE',
      'assignment',
      row.rows[0].id,
      { providerId, sharedCredentialsAllowed: shared },
    );
    return { id: row.rows[0].id, isAllowed: allowed, sharedUseOperational: false };
  });
}

async function allowedProvider(
  c: PoolClient,
  scope: HubScope,
  providerId: number,
  env: 'SANDBOX' | 'PRODUCTION',
) {
  const p = await c.query(
    `SELECT p.id,p.adapter_key AS "adapterKey",p.status,e.is_available AS "isAvailable",a.is_allowed AS "isAllowed" FROM payment_provider_definitions p
    JOIN payment_provider_environments e ON e.provider_id=p.id AND e.environment=$4
    LEFT JOIN payment_provider_assignments a ON a.provider_id=p.id AND a.facility_id=$3 AND a.tenant_id=$2
    WHERE p.id=$1`,
    [providerId, scope.tenantId, scope.facilityId, env],
  );
  if (
    !p.rows.length ||
    p.rows[0].status !== 'ACTIVE' ||
    !p.rows[0].isAllowed ||
    !p.rows[0].isAvailable
  )
    throw new PaymentHubError(
      'PROVIDER_NOT_AVAILABLE',
      'Provider or environment is not available to this facility.',
      403,
    );
  return p.rows[0] as { id: number; adapterKey: string };
}
async function integration(c: PoolClient, scope: HubScope, id: number, lock = false) {
  const r = await c.query(
    `SELECT i.*,p.adapter_key FROM facility_payment_integrations i JOIN payment_provider_definitions p ON p.id=i.provider_id WHERE i.id=$1 AND i.tenant_id=$2 AND i.facility_id=$3 ${lock ? 'FOR UPDATE OF i' : ''}`,
    [numberId(id), scope.tenantId, scope.facilityId],
  );
  if (!r.rows.length)
    throw new PaymentHubError('INTEGRATION_NOT_FOUND', 'Integration not found.', 404);
  return r.rows[0];
}
export async function facilityCatalogue(scope: HubScope, includeAccounts: boolean) {
  const [providers, configs, policies, accounts] = await Promise.all([
    pool.query(
      `SELECT p.id,p.code,p.display_name AS "displayName",p.adapter_key AS "adapterKey",p.documentation_url AS "documentationUrl",p.description,
      COALESCE(a.is_allowed,false) AS "isAllowed",COALESCE(r.status,'NOT_REQUESTED') AS "requestStatus",
      COALESCE((SELECT array_agg(e.environment ORDER BY e.environment) FROM payment_provider_environments e WHERE e.provider_id=p.id AND e.is_available),'{}') AS "availableEnvironments"
      FROM payment_provider_definitions p LEFT JOIN payment_provider_assignments a ON a.provider_id=p.id AND a.tenant_id=$1 AND a.facility_id=$2
      LEFT JOIN payment_provider_access_requests r ON r.provider_id=p.id AND r.tenant_id=$1 AND r.facility_id=$2
      WHERE p.status='ACTIVE' AND (p.requestable OR a.is_allowed) ORDER BY p.display_name`,
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      `SELECT i.id,i.provider_id AS "providerId",i.environment,i.enabled_capabilities AS "enabledCapabilities",i.is_enabled AS "isEnabled",i.connection_status AS "connectionStatus",i.last_health_at AS "lastHealthAt",i.last_error_code AS "lastErrorCode",i.production_approval AS "productionApproval",
      CASE WHEN p.adapter_key='MPESA_DARAJA' THEN 'PAYMENT_HUB_T'||i.tenant_id||'_F'||i.facility_id||'_I'||i.id||'_'||i.environment ELSE NULL END AS "credentialEnvName",
      (i.is_enabled AND EXISTS(SELECT 1 FROM payment_provider_environments e WHERE e.provider_id=i.provider_id AND e.environment=i.environment AND e.is_available)
       AND NOT EXISTS(SELECT 1 FROM unnest(i.enabled_capabilities) AS selected(capability) LEFT JOIN payment_provider_capability_policies pc ON pc.provider_id=i.provider_id AND pc.capability=selected.capability WHERE COALESCE(pc.is_allowed,false)=false)) AS "isEffective",
      EXISTS(SELECT 1 FROM facility_payment_secrets s WHERE s.integration_id=i.id AND s.tenant_id=i.tenant_id AND s.facility_id=i.facility_id) AS "credentialsConfigured"
      FROM facility_payment_integrations i JOIN payment_provider_definitions p ON p.id=i.provider_id AND p.status='ACTIVE'
      JOIN payment_provider_assignments a ON a.provider_id=i.provider_id AND a.tenant_id=i.tenant_id AND a.facility_id=i.facility_id AND a.is_allowed
      WHERE i.tenant_id=$1 AND i.facility_id=$2 ORDER BY i.id`,
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT provider_id AS "providerId",capability FROM payment_provider_capability_policies WHERE is_allowed',
    ),
    includeAccounts
      ? pool.query(
          `SELECT a.id,a.integration_id AS "integrationId",a.alias,a.account_type AS "accountType",a.masked_identifier AS "maskedIdentifier",a.authorization_state AS "authorizationState",a.bank_account_id AS "bankAccountId"
      FROM facility_payment_accounts a JOIN facility_payment_integrations i ON i.id=a.integration_id AND i.tenant_id=a.tenant_id AND i.facility_id=a.facility_id
      JOIN payment_provider_assignments p ON p.provider_id=i.provider_id AND p.tenant_id=i.tenant_id AND p.facility_id=i.facility_id AND p.is_allowed
      JOIN payment_provider_definitions d ON d.id=i.provider_id AND d.status='ACTIVE' WHERE a.tenant_id=$1 AND a.facility_id=$2 ORDER BY a.id`,
          [scope.tenantId, scope.facilityId],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    providers: providers.rows.map((p) => ({
      ...p,
      adapter: {
        ...providerBoundary(p.adapterKey).descriptor,
        implementedCapabilities: providerBoundary(
          p.adapterKey,
        ).descriptor.implementedCapabilities.filter((capability) =>
          policies.rows.some(
            (policy) => policy.providerId === p.id && policy.capability === capability,
          ),
        ),
      },
      integrations: configs.rows
        .filter((i) => i.providerId === p.id)
        .map((i) => ({
          ...i,
          credentials: i.credentialsConfigured ? CREDENTIAL_MASK : 'Not configured',
          accounts: accounts.rows.filter((a) => a.integrationId === i.id),
        })),
    })),
    notice:
      'Sandbox status checks do not prove merchant approval. Bank adapters and transfers are not enabled. Production activation is blocked.',
  };
}
export async function requestAccess(scope: HubScope, providerId: number) {
  numberId(providerId);
  return tx(async (c) => {
    const p = await c.query(
      `SELECT id FROM payment_provider_definitions WHERE id=$1 AND status='ACTIVE' AND requestable`,
      [providerId],
    );
    if (!p.rows.length)
      throw new PaymentHubError(
        'PROVIDER_NOT_AVAILABLE',
        'Provider is not available for requests.',
        404,
      );
    const r = await c.query(
      `INSERT INTO payment_provider_access_requests(provider_id,tenant_id,facility_id,requested_by_user_id) VALUES($1,$2,$3,$4)
      ON CONFLICT(provider_id,facility_id) DO UPDATE SET status='PENDING',requested_by_user_id=EXCLUDED.requested_by_user_id,requested_at=now() RETURNING id`,
      [providerId, scope.tenantId, scope.facilityId, scope.actorUserId],
    );
    await audit(c, scope.actorUserId, scope, 'REQUEST', 'access', r.rows[0].id, { providerId });
    return { id: r.rows[0].id, status: 'PENDING' };
  });
}
export async function configureIntegration(
  scope: HubScope,
  providerId: number,
  input: Record<string, unknown>,
) {
  numberId(providerId);
  const env = environment(input.environment);
  if (!Array.isArray(input.capabilities) || input.capabilities.some((x) => typeof x !== 'string'))
    throw new PaymentHubError('INVALID_CAPABILITIES', 'Select implemented capabilities.');
  const caps = Array.from(new Set(input.capabilities as string[])).sort();
  return tx(async (c) => {
    const p = await allowedProvider(c, scope, providerId, env);
    const available = providerBoundary(p.adapterKey).descriptor.implementedCapabilities;
    if (caps.some((x) => !available.includes(x as Capability)) || caps.includes('TRANSFER'))
      throw new PaymentHubError(
        'UNSUPPORTED_CAPABILITY',
        'One or more capabilities are not implemented or permitted.',
        403,
      );
    await requireAllowedCapabilities(c, providerId, caps);
    const r = await c.query(
      `INSERT INTO facility_payment_integrations(provider_id,tenant_id,facility_id,environment,enabled_capabilities)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider_id,facility_id,environment) DO UPDATE SET enabled_capabilities=EXCLUDED.enabled_capabilities,
      is_enabled=CASE WHEN facility_payment_integrations.enabled_capabilities IS DISTINCT FROM EXCLUDED.enabled_capabilities THEN false ELSE facility_payment_integrations.is_enabled END,
      production_approval=CASE WHEN facility_payment_integrations.enabled_capabilities IS DISTINCT FROM EXCLUDED.enabled_capabilities THEN 'NOT_REQUESTED' ELSE facility_payment_integrations.production_approval END,
      revision=facility_payment_integrations.revision+CASE WHEN facility_payment_integrations.enabled_capabilities IS DISTINCT FROM EXCLUDED.enabled_capabilities THEN 1 ELSE 0 END,updated_at=now() RETURNING id`,
      [providerId, scope.tenantId, scope.facilityId, env, caps],
    );
    await audit(c, scope.actorUserId, scope, 'CONFIGURE', 'integration', r.rows[0].id, {
      environment: env,
      capabilities: caps,
    });
    return { id: r.rows[0].id, environment: env };
  });
}

export async function saveCredentials(
  scope: HubScope,
  integrationId: number,
  input: Record<string, unknown>,
) {
  try {
    return await tx(async (c) => {
      const i = await integration(c, scope, integrationId, true);
      await allowedProvider(c, scope, i.provider_id, i.environment);
      let values: Record<string, string>;
      let identityHash: string | null = null;
      if (i.adapter_key === 'MPESA_DARAJA') {
        // This application database is not assumed to be an approved secret
        // store. The real secret is provisioned only in the server environment.
        // The variable is fixed to this tenant, facility, integration and environment.
        if (
          input.source !== 'ENVIRONMENT' ||
          ['consumerKey', 'consumerSecret', 'passkey', 'shortcode'].some((field) => field in input)
        )
          throw new PaymentHubError(
            'INVALID_INPUT',
            'Configure the facility-specific server environment reference; do not send credentials in the request.',
          );
        const environmentReference = credentialVariable(scope, integrationId, i.environment);
        const credentials = darajaEnvironmentCredentials(environmentReference);
        values = { environmentReference, valueFingerprint: credentialFingerprint(credentials) };
        // The same consumer credential cannot silently serve two integrations.
        // Contractually approved shared credentials remain deliberately unsupported.
        identityHash = privateDigest(`daraja-consumer:${credentials.consumerKey}`);
      } else {
        // No bank-specific credential format has been verified. Record only an
        // opaque facility reference; bank adapters never resolve or use it.
        const ref = stringField(input.secretReference, 'Secret reference', 160);
        if (!/^(secret|env):[A-Za-z0-9/_-]{3,140}$/.test(ref))
          throw new PaymentHubError(
            'INVALID_INPUT',
            'Use a facility-owned secret-manager or environment reference.',
          );
        values = { secretReference: ref };
      }
      const encrypted = encryptFacilitySecret(
        { tenantId: scope.tenantId, facilityId: scope.facilityId, integrationId },
        values,
      );
      await c.query(
        `INSERT INTO facility_payment_secrets(integration_id,tenant_id,facility_id,encrypted_value,credential_identity_hash) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(integration_id) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,credential_identity_hash=EXCLUDED.credential_identity_hash,updated_at=now()`,
        [integrationId, scope.tenantId, scope.facilityId, encrypted, identityHash],
      );
      await c.query(
        `UPDATE facility_payment_integrations SET is_enabled=false,connection_status='NOT_TESTED',last_health_at=NULL,last_error_code=NULL,production_approval='NOT_REQUESTED',approval_reference=NULL,approved_by_user_id=NULL,approved_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1`,
        [integrationId],
      );
      await audit(c, scope.actorUserId, scope, 'UPDATE', 'credentials', integrationId, {
        configured: true,
        source: i.adapter_key === 'MPESA_DARAJA' ? 'ENVIRONMENT' : 'REFERENCE',
      });
      return {
        configured: true,
        message: 'Credential reference saved. The integration was disabled and must be rechecked.',
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new PaymentHubError(
        'CREDENTIAL_ALREADY_ASSIGNED',
        'This provider credential is already assigned to an integration; shared credentials are not supported.',
        409,
      );
    throw error;
  }
}
export async function addFacilityAccount(
  scope: HubScope,
  integrationId: number,
  input: Record<string, unknown>,
) {
  const alias = stringField(input.alias, 'Account alias', 80);
  if (/\d{5,}/.test(alias))
    throw new PaymentHubError(
      'INVALID_INPUT',
      'Do not include a full account number in the alias.',
    );
  const type = input.accountType;
  if (type !== 'BANK' && type !== 'MOBILE_MONEY' && type !== 'OTHER')
    throw new PaymentHubError('INVALID_INPUT', 'Choose a valid account type.');
  const lastFour = stringField(input.lastFour, 'Last four digits', 4);
  if (!/^\d{4}$/.test(lastFour))
    throw new PaymentHubError('INVALID_INPUT', 'Enter only the last four digits.');
  const bankId = input.bankAccountId ? numberId(input.bankAccountId) : null;
  try {
    return await tx(async (c) => {
      const i = await integration(c, scope, integrationId, true);
      await allowedProvider(c, scope, i.provider_id, i.environment);
      if (bankId) {
        const b = await c.query(
          'SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
          [bankId, scope.tenantId, scope.facilityId],
        );
        if (!b.rows.length)
          throw new PaymentHubError('ACCOUNT_NOT_FOUND', 'Bank account not found.', 404);
      }
      const row = await c.query(
        `INSERT INTO facility_payment_accounts(integration_id,tenant_id,facility_id,alias,account_type,masked_identifier,bank_account_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,alias,account_type AS "accountType",masked_identifier AS "maskedIdentifier",authorization_state AS "authorizationState"`,
        [integrationId, scope.tenantId, scope.facilityId, alias, type, `••••${lastFour}`, bankId],
      );
      await c.query(
        `UPDATE facility_payment_integrations SET is_enabled=false,production_approval='NOT_REQUESTED',approval_reference=NULL,revision=revision+1,updated_at=now() WHERE id=$1`,
        [integrationId],
      );
      await audit(c, scope.actorUserId, scope, 'CREATE', 'account', row.rows[0].id, {
        integrationId,
        accountType: type,
        authorizationState: 'PENDING',
      });
      return row.rows[0];
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new PaymentHubError(
        'ACCOUNT_ALIAS_EXISTS',
        'That alias already exists for this integration.',
        409,
      );
    throw error;
  }
}
async function secretFor(c: PoolClient, scope: HubScope, integrationId: number) {
  const result = await c.query(
    `SELECT s.encrypted_value,i.environment,p.adapter_key FROM facility_payment_secrets s
    JOIN facility_payment_integrations i ON i.id=s.integration_id AND i.tenant_id=s.tenant_id AND i.facility_id=s.facility_id
    JOIN payment_provider_definitions p ON p.id=i.provider_id
    WHERE s.integration_id=$1 AND s.tenant_id=$2 AND s.facility_id=$3`,
    [integrationId, scope.tenantId, scope.facilityId],
  );
  if (!result.rows.length)
    throw new PaymentHubError(
      'CREDENTIALS_REQUIRED',
      'Facility-owned credentials are required.',
      409,
    );
  const row = result.rows[0];
  const stored = decryptFacilitySecret(
    { tenantId: scope.tenantId, facilityId: scope.facilityId, integrationId },
    row.encrypted_value,
  );
  if (row.adapter_key !== 'MPESA_DARAJA') return stored; // Bank references are not resolved.
  const expected = credentialVariable(scope, integrationId, row.environment);
  if (stored.environmentReference !== expected || !stored.valueFingerprint)
    throw new PaymentHubError('SECRET_UNAVAILABLE', 'Stored credential reference is invalid.', 503);
  const credentials = darajaEnvironmentCredentials(expected);
  if (credentialFingerprint(credentials) !== stored.valueFingerprint)
    throw new PaymentHubError(
      'CREDENTIALS_CHANGED',
      'The server credential changed. Reconfigure the reference and repeat the sandbox check.',
      409,
    );
  return credentials;
}
export async function testConnection(scope: HubScope, integrationId: number) {
  const prepared = await tx(async (c) => {
    const i = await integration(c, scope, integrationId);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    if (i.environment !== 'SANDBOX')
      throw new PaymentHubError(
        'PRODUCTION_BLOCKED',
        'Production connection tests are not enabled until the provider contract and security review are complete.',
        403,
      );
    await requireAllowedCapabilities(c, i.provider_id, ['HEALTH']);
    const secret = await secretFor(c, scope, integrationId);
    return { adapter: providerBoundary(i.adapter_key, secret), revision: i.revision };
  });
  if (!prepared.adapter.health)
    throw new PaymentHubError(
      'CAPABILITY_UNAVAILABLE',
      'This provider does not yet have a verified health-check adapter.',
      409,
    );
  let status = 'HEALTHY',
    errorCode: string | null = null;
  try {
    await prepared.adapter.health.check();
  } catch {
    status = 'UNAVAILABLE';
    errorCode = 'PROVIDER_UNAVAILABLE';
  }
  return tx(async (c) => {
    const i = await integration(c, scope, integrationId, true);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    await requireAllowedCapabilities(c, i.provider_id, ['HEALTH']);
    if (i.revision !== prepared.revision)
      throw new PaymentHubError(
        'CONFIGURATION_CHANGED',
        'Configuration changed during the health check; test again.',
        409,
      );
    await c.query(
      'UPDATE facility_payment_integrations SET connection_status=$1,last_health_at=now(),last_error_code=$2 WHERE id=$3',
      [status, errorCode, integrationId],
    );
    await audit(c, scope.actorUserId, scope, 'TEST', 'integration', integrationId, {
      status,
      scope: 'OAUTH_ONLY',
    });
    return {
      status,
      lastErrorCode: errorCode,
      notice:
        'OAuth test only; it does not verify merchant approval, callbacks, payment or settlement.',
    };
  });
}
function callbackUrl(): string {
  const base = process.env.PAYMENT_HUB_CALLBACK_BASE_URL;
  if (!base)
    throw new PaymentHubError(
      'CALLBACK_UNCONFIGURED',
      'A public HTTPS callback base URL is not configured.',
      503,
    );
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
      throw new Error('invalid');
    return new URL('/api/payment-hub/webhooks/mpesa', u).toString();
  } catch {
    throw new PaymentHubError(
      'CALLBACK_UNCONFIGURED',
      'A public HTTPS callback base URL is not configured.',
      503,
    );
  }
}
export async function setIntegrationEnabled(
  scope: HubScope,
  integrationId: number,
  enabled: boolean,
) {
  return tx(async (c) => {
    const i = await integration(c, scope, integrationId, true);
    if (enabled) {
      await allowedProvider(c, scope, i.provider_id, i.environment);
      const descriptor = providerBoundary(i.adapter_key).descriptor;
      if (
        i.environment === 'PRODUCTION' &&
        (i.production_approval !== 'APPROVED' || !descriptor.productionReady)
      )
        throw new PaymentHubError(
          'PRODUCTION_BLOCKED',
          'Production activation is blocked until provider approval, implementation review and verified security controls are complete.',
          403,
        );
      if (!descriptor.implementedCapabilities.length || !i.enabled_capabilities.length)
        throw new PaymentHubError(
          'CAPABILITY_UNAVAILABLE',
          'No implemented capability has been selected.',
          409,
        );
      await requireAllowedCapabilities(c, i.provider_id, i.enabled_capabilities);
      if (i.connection_status !== 'HEALTHY')
        throw new PaymentHubError(
          'HEALTH_CHECK_REQUIRED',
          'Run a successful sandbox OAuth check before enabling.',
          409,
        );
      const secrets = await c.query(
        'SELECT 1 FROM facility_payment_secrets WHERE integration_id=$1 AND tenant_id=$2 AND facility_id=$3',
        [integrationId, scope.tenantId, scope.facilityId],
      );
      const accounts = await c.query(
        'SELECT 1 FROM facility_payment_accounts WHERE integration_id=$1 AND tenant_id=$2 AND facility_id=$3',
        [integrationId, scope.tenantId, scope.facilityId],
      );
      if (!secrets.rows.length || !accounts.rows.length)
        throw new PaymentHubError(
          'SETUP_INCOMPLETE',
          'Add facility-owned credentials and a masked account alias before enabling.',
          409,
        );
      if (i.adapter_key === 'MPESA_DARAJA') {
        await secretFor(c, scope, integrationId);
        if (i.enabled_capabilities.includes('PAYMENT_COLLECTION')) callbackUrl();
      }
    }
    await c.query(
      'UPDATE facility_payment_integrations SET is_enabled=$1,updated_at=now() WHERE id=$2',
      [enabled, integrationId],
    );
    await audit(
      c,
      scope.actorUserId,
      scope,
      enabled ? 'ENABLE' : 'DISABLE',
      'integration',
      integrationId,
      { environment: i.environment },
    );
    return { enabled };
  });
}
export async function requestProduction(scope: HubScope, integrationId: number) {
  return tx(async (c) => {
    const i = await integration(c, scope, integrationId, true);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    if (i.environment !== 'PRODUCTION')
      throw new PaymentHubError(
        'INVALID_ENVIRONMENT',
        'Request approval for the production configuration.',
      );
    const secret = await c.query(
      'SELECT 1 FROM facility_payment_secrets WHERE integration_id=$1 AND facility_id=$2 AND tenant_id=$3',
      [integrationId, scope.facilityId, scope.tenantId],
    );
    const account = await c.query(
      'SELECT 1 FROM facility_payment_accounts WHERE integration_id=$1 AND facility_id=$2 AND tenant_id=$3',
      [integrationId, scope.facilityId, scope.tenantId],
    );
    const sandbox = await c.query(
      `SELECT id FROM facility_payment_integrations WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3 AND environment='SANDBOX' AND connection_status='HEALTHY'`,
      [i.provider_id, scope.tenantId, scope.facilityId],
    );
    if (
      !secret.rows.length ||
      !account.rows.length ||
      !sandbox.rows.length ||
      !i.enabled_capabilities.length
    )
      throw new PaymentHubError(
        'SETUP_INCOMPLETE',
        'Configure production credentials and an account, select supported capabilities and complete a sandbox OAuth check first.',
        409,
      );
    await requireAllowedCapabilities(c, i.provider_id, i.enabled_capabilities);
    if (i.adapter_key === 'MPESA_DARAJA') {
      await secretFor(c, scope, integrationId);
      await secretFor(c, scope, sandbox.rows[0].id);
    }
    await c.query(
      `UPDATE facility_payment_integrations SET production_approval='PENDING',production_requested_by_user_id=$1,approved_by_user_id=NULL,approval_reference=NULL,approved_at=NULL,is_enabled=false,updated_at=now() WHERE id=$2`,
      [scope.actorUserId, integrationId],
    );
    await audit(c, scope.actorUserId, scope, 'REQUEST', 'production_approval', integrationId, {});
    return { approval: 'PENDING' };
  });
}
export async function decideProduction(
  actor: number,
  integrationId: number,
  input: Record<string, unknown>,
) {
  numberId(integrationId);
  const decision = input.decision;
  if (decision !== 'APPROVED' && decision !== 'REJECTED')
    throw new PaymentHubError('INVALID_INPUT', 'Choose an approval or rejection.');
  const evidence = reference(input.approvalReference, 'Approval reference');
  return tx(async (c) => {
    const result = await c.query(
      `SELECT i.*,p.status,e.is_available,a.is_allowed,
      EXISTS(SELECT 1 FROM facility_payment_secrets s WHERE s.integration_id=i.id AND s.tenant_id=i.tenant_id AND s.facility_id=i.facility_id) AS has_secret,
      EXISTS(SELECT 1 FROM facility_payment_accounts a2 WHERE a2.integration_id=i.id AND a2.tenant_id=i.tenant_id AND a2.facility_id=i.facility_id) AS has_account,
      EXISTS(SELECT 1 FROM facility_payment_integrations s2 WHERE s2.provider_id=i.provider_id AND s2.tenant_id=i.tenant_id AND s2.facility_id=i.facility_id AND s2.environment='SANDBOX' AND s2.connection_status='HEALTHY') AS sandbox_healthy
      FROM facility_payment_integrations i JOIN payment_provider_definitions p ON p.id=i.provider_id
      JOIN payment_provider_environments e ON e.provider_id=i.provider_id AND e.environment=i.environment
      LEFT JOIN payment_provider_assignments a ON a.provider_id=i.provider_id AND a.tenant_id=i.tenant_id AND a.facility_id=i.facility_id WHERE i.id=$1 FOR UPDATE OF i`,
      [integrationId],
    );
    const i = result.rows[0];
    if (!i) throw new PaymentHubError('INTEGRATION_NOT_FOUND', 'Integration not found.', 404);
    if (i.environment !== 'PRODUCTION' || i.production_approval !== 'PENDING')
      throw new PaymentHubError(
        'APPROVAL_NOT_PENDING',
        'There is no pending production request.',
        409,
      );
    if (
      decision === 'APPROVED' &&
      (i.status !== 'ACTIVE' ||
        !i.is_available ||
        !i.is_allowed ||
        !i.has_secret ||
        !i.has_account ||
        !i.sandbox_healthy ||
        !i.enabled_capabilities.length)
    )
      throw new PaymentHubError(
        'SETUP_INCOMPLETE',
        'Assignment, environment and facility setup must still be valid.',
        409,
      );
    await c.query(
      `UPDATE facility_payment_integrations SET production_approval=$1,approval_reference=$2,approved_by_user_id=$3,approved_at=now(),is_enabled=false,updated_at=now() WHERE id=$4`,
      [decision, evidence, actor, integrationId],
    );
    await audit(
      c,
      actor,
      { tenantId: i.tenant_id, facilityId: i.facility_id },
      decision,
      'production_approval',
      integrationId,
      { productionActivationBlocked: true },
    );
    return {
      approval: decision,
      activationBlocked: true,
      notice:
        'Approval records the decision; it does not override the adapter production-readiness gate.',
    };
  });
}

export async function listFacilityTransactions(scope: HubScope) {
  const [transactions, events, reconciliations] = await Promise.all([
    pool.query(
      `SELECT t.id,t.integration_id AS "integrationId",p.display_name AS provider,i.environment,t.invoice_id AS "invoiceId",inv.invoice_number AS "invoiceNumber",t.amount_cents::text AS "requestedAmountCents",t.provider_request_id AS "providerRequestId",t.status,t.result_code AS "resultCode",t.created_at AS "createdAt",t.last_query_at AS "lastQueryAt",
      (SELECT count(*)::int FROM payment_hub_webhook_events e WHERE e.transaction_id=t.id AND e.tenant_id=t.tenant_id AND e.facility_id=t.facility_id) AS "unverifiedNotifications"
      FROM payment_hub_transactions t JOIN facility_payment_integrations i ON i.id=t.integration_id AND i.tenant_id=t.tenant_id AND i.facility_id=t.facility_id
      JOIN payment_provider_definitions p ON p.id=i.provider_id JOIN billing_invoices inv ON inv.id=t.invoice_id AND inv.tenant_id=t.tenant_id AND inv.facility_id=t.facility_id
      WHERE t.tenant_id=$1 AND t.facility_id=$2 ORDER BY t.id DESC LIMIT 200`,
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      `SELECT id,transaction_id AS "transactionId",result_code AS "resultCode",verification_state AS "verificationState",received_at AS "receivedAt" FROM payment_hub_webhook_events WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 100`,
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      `SELECT id,transaction_id AS "transactionId",billing_payment_id AS "billingPaymentId",status,matched_at AS "matchedAt",voided_at AS "voidedAt" FROM payment_hub_reconciliations WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 100`,
      [scope.tenantId, scope.facilityId],
    ),
  ]);
  return {
    transactions: transactions.rows,
    notifications: events.rows,
    reconciliations: reconciliations.rows,
    notice:
      'A request or unverified notification is not payment. A sandbox confirmation never settles a real invoice.',
  };
}
export async function initiateCollection(scope: HubScope, input: Record<string, unknown>) {
  const integrationId = numberId(input.integrationId),
    invoiceId = numberId(input.invoiceId),
    key = reference(input.idempotencyKey, 'Idempotency key');
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (!/^254[17]\d{8}$/.test(phone))
    throw new PaymentHubError('INVALID_COLLECTION', 'Use a Kenyan phone number in 254 format.');
  const cents = parseMoneyToCents(input.amountKes as string | number);
  if (cents === null || cents <= 0 || cents % 100 !== 0)
    throw new PaymentHubError(
      'INVALID_COLLECTION',
      'Use a positive whole-KES amount for the sandbox request.',
    );
  const allowOverpayment = input.allowOverpayment === true;
  const hash = privateDigest(
    JSON.stringify({ integrationId, invoiceId, phone, cents, allowOverpayment }),
  );
  const prepared = await tx(async (c) => {
    const existing = await c.query(
      'SELECT id,status,request_hash FROM payment_hub_transactions WHERE facility_id=$1 AND tenant_id=$2 AND idempotency_key=$3',
      [scope.facilityId, scope.tenantId, key],
    );
    if (existing.rows.length) {
      if (existing.rows[0].request_hash !== hash)
        throw new PaymentHubError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was used for a different request.',
          409,
        );
      return { replay: true, id: existing.rows[0].id, status: existing.rows[0].status };
    }
    const i = await integration(c, scope, integrationId, true);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    if (!i.is_enabled || !i.enabled_capabilities.includes('PAYMENT_COLLECTION'))
      throw new PaymentHubError(
        'CAPABILITY_UNAVAILABLE',
        'Payment collection is not enabled for this integration.',
        403,
      );
    if (i.environment !== 'SANDBOX' || !providerBoundary(i.adapter_key).descriptor.sandboxOnly)
      throw new PaymentHubError(
        'PRODUCTION_BLOCKED',
        'Only the reviewed sandbox path is available.',
        403,
      );
    await requireAllowedCapabilities(c, i.provider_id, i.enabled_capabilities);
    const f = await c.query(`SELECT enabled_modules FROM facilities WHERE id=$1 AND tenant_id=$2`, [
      scope.facilityId,
      scope.tenantId,
    ]);
    if (
      !Array.isArray(f.rows[0]?.enabled_modules) ||
      !f.rows[0].enabled_modules.includes('finance')
    )
      throw new PaymentHubError('FINANCE_DISABLED', 'Finance is disabled for this facility.', 403);
    const inv = await c.query(
      'SELECT id,balance_amount,status,voided_at FROM billing_invoices WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [invoiceId, scope.tenantId, scope.facilityId],
    );
    if (!inv.rows.length) throw new PaymentHubError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    if (inv.rows[0].voided_at || inv.rows[0].status === 'Void')
      throw new PaymentHubError('INVOICE_VOIDED', 'This invoice cannot accept payments.', 409);
    const balance = parseMoneyToCents(inv.rows[0].balance_amount) ?? 0;
    if (cents > balance && !allowOverpayment)
      throw new PaymentHubError(
        'OVERPAYMENT_CONFIRMATION_REQUIRED',
        'The amount exceeds the invoice balance; explicit overpayment confirmation is required.',
        409,
      );
    const secret = await secretFor(c, scope, integrationId);
    const adapter = providerBoundary(i.adapter_key, secret);
    if (!adapter.collection)
      throw new PaymentHubError(
        'CAPABILITY_UNAVAILABLE',
        'Collection is not implemented for this provider.',
        409,
      );
    const callback = callbackUrl();
    const row = await c.query(
      `INSERT INTO payment_hub_transactions(integration_id,tenant_id,facility_id,invoice_id,amount_cents,idempotency_key,request_hash,initiated_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(facility_id,idempotency_key) DO NOTHING RETURNING id`,
      [
        integrationId,
        scope.tenantId,
        scope.facilityId,
        invoiceId,
        cents,
        key,
        hash,
        scope.actorUserId,
      ],
    );
    if (!row.rows.length) {
      const retry = await c.query(
        'SELECT id,status,request_hash FROM payment_hub_transactions WHERE facility_id=$1 AND tenant_id=$2 AND idempotency_key=$3',
        [scope.facilityId, scope.tenantId, key],
      );
      if (!retry.rows.length || retry.rows[0].request_hash !== hash)
        throw new PaymentHubError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was used for a different request.',
          409,
        );
      return { replay: true, id: retry.rows[0].id, status: retry.rows[0].status };
    }
    await audit(c, scope.actorUserId, scope, 'INITIATE', 'transaction', row.rows[0].id, {
      environment: i.environment,
    });
    return { replay: false, id: row.rows[0].id, status: 'INITIATING', adapter, callback };
  });
  if (prepared.replay)
    return {
      transactionId: prepared.id,
      status: prepared.status,
      idempotentReplay: true,
      notice: 'A prior request is not repeated.',
    };
  try {
    const result = await prepared.adapter!.collection!.initiate({
      phone,
      amountKes: cents / 100,
      callbackUrl: prepared.callback!,
      accountReference: `I${invoiceId}`,
    });
    await tx(async (c) => {
      await c.query(
        `UPDATE payment_hub_transactions SET provider_request_id=$1,status='PENDING',updated_at=now() WHERE id=$2 AND tenant_id=$3 AND facility_id=$4 AND status='INITIATING'`,
        [result.checkoutRequestId, prepared.id, scope.tenantId, scope.facilityId],
      );
      await audit(c, scope.actorUserId, scope, 'ACCEPTED', 'transaction', prepared.id, {
        status: 'PENDING',
      });
    });
    return {
      transactionId: prepared.id,
      status: 'PENDING',
      idempotentReplay: false,
      notice: 'Request accepted for processing; no invoice or receipt was changed.',
    };
  } catch {
    // An HTTP timeout, connection loss, malformed response, or database error
    // after dispatch is ambiguous. Never retry the same STK automatically.
    await tx(async (c) => {
      await c.query(
        `UPDATE payment_hub_transactions SET status='UNKNOWN',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='INITIATING'`,
        [prepared.id, scope.tenantId, scope.facilityId],
      );
      await audit(c, scope.actorUserId, scope, 'UNKNOWN', 'transaction', prepared.id, {
        reason: 'DISPATCH_OUTCOME_UNKNOWN',
      });
    });
    return {
      transactionId: prepared.id,
      status: 'UNKNOWN',
      idempotentReplay: false,
      notice: 'The provider outcome is unknown. Do not repeat the request until it is reviewed.',
    };
  }
}
export async function queryTransaction(scope: HubScope, transactionId: number) {
  numberId(transactionId);
  const prepared = await tx(async (c) => {
    const row = await c.query(
      'SELECT * FROM payment_hub_transactions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [transactionId, scope.tenantId, scope.facilityId],
    );
    if (!row.rows.length)
      throw new PaymentHubError('TRANSACTION_NOT_FOUND', 'Transaction not found.', 404);
    const t = row.rows[0],
      i = await integration(c, scope, t.integration_id);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    if (!i.is_enabled || !i.enabled_capabilities.includes('PAYMENT_STATUS'))
      throw new PaymentHubError('CAPABILITY_UNAVAILABLE', 'Payment status is not enabled.', 403);
    await requireAllowedCapabilities(c, i.provider_id, i.enabled_capabilities);
    if (i.environment !== 'SANDBOX')
      throw new PaymentHubError(
        'PRODUCTION_BLOCKED',
        'Production status queries are not enabled.',
        403,
      );
    if (!t.provider_request_id)
      throw new PaymentHubError(
        'REFERENCE_UNAVAILABLE',
        'The provider did not return a request reference; manual review is required.',
        409,
      );
    const adapter = providerBoundary(i.adapter_key, await secretFor(c, scope, i.id));
    if (!adapter.status)
      throw new PaymentHubError('CAPABILITY_UNAVAILABLE', 'Status query is not implemented.', 409);
    return { adapter, reference: t.provider_request_id, integrationId: i.id, revision: i.revision };
  });
  let outcome: { outcome: 'CONFIRMED' | 'UNKNOWN'; resultCode: string | null };
  try {
    outcome = await prepared.adapter.status!.query(prepared.reference);
  } catch {
    throw new PaymentHubError(
      'PROVIDER_UNAVAILABLE',
      'Status query failed or timed out; payment status is unchanged.',
      503,
    );
  }
  return tx(async (c) => {
    const i = await integration(c, scope, prepared.integrationId, true);
    await allowedProvider(c, scope, i.provider_id, i.environment);
    await requireAllowedCapabilities(c, i.provider_id, i.enabled_capabilities);
    if (i.revision !== prepared.revision || !i.is_enabled)
      throw new PaymentHubError(
        'CONFIGURATION_CHANGED',
        'Configuration changed during the query; review the transaction.',
        409,
      );
    const row = await c.query(
      'SELECT status,provider_request_id FROM payment_hub_transactions WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [transactionId, scope.tenantId, scope.facilityId],
    );
    if (!row.rows.length || row.rows[0].provider_request_id !== prepared.reference)
      throw new PaymentHubError('TRANSACTION_NOT_FOUND', 'Transaction not found.', 404);
    let status = row.rows[0].status as string;
    if (outcome.outcome === 'CONFIRMED')
      status =
        status === 'FAILED' || status === 'REVIEW_REQUIRED'
          ? 'REVIEW_REQUIRED'
          : 'PROVIDER_CONFIRMED';
    else if (
      status === 'PROVIDER_CONFIRMED' &&
      outcome.resultCode !== null &&
      outcome.resultCode !== '0'
    )
      status = 'REVIEW_REQUIRED';
    // An inconclusive later query cannot erase an earlier provider-confirmed
    // result or create a success from pending/failed/unknown.
    await c.query(
      'UPDATE payment_hub_transactions SET status=$1,result_code=$2,last_query_at=now(),updated_at=now() WHERE id=$3',
      [status, outcome.resultCode, transactionId],
    );
    await audit(c, scope.actorUserId, scope, 'QUERY', 'transaction', transactionId, {
      status,
      environment: i.environment,
    });
    return {
      transactionId,
      status,
      notice:
        'Provider status only. This does not create a receipt, verify callback authenticity, or settle an invoice.',
    };
  });
}

/** A callback is an untrusted hint, not an authenticated provider event. */
export async function recordDarajaCallback(body: unknown) {
  const root =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const b =
    root?.Body && typeof root.Body === 'object' && !Array.isArray(root.Body)
      ? (root.Body as Record<string, unknown>)
      : null;
  const result =
    b?.stkCallback && typeof b.stkCallback === 'object' && !Array.isArray(b.stkCallback)
      ? (b.stkCallback as Record<string, unknown>)
      : null;
  const checkout = result?.CheckoutRequestID;
  const resultCode =
    typeof result?.ResultCode === 'number' || typeof result?.ResultCode === 'string'
      ? String(result.ResultCode)
      : '';
  if (
    typeof checkout !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(checkout) ||
    !/^\d{1,8}$/.test(resultCode)
  )
    throw new PaymentHubError('INVALID_CALLBACK', 'Invalid callback.', 400);
  // Only the stable outcome is deduplicated. Reordered fields, added metadata
  // and replayed payloads cannot generate fresh events for the same outcome.
  const hash = privateDigest(`${checkout}:${resultCode}`);
  await tx(async (c) => {
    const t = await c.query(
      `SELECT t.id,t.tenant_id,t.facility_id FROM payment_hub_transactions t JOIN facility_payment_integrations i ON i.id=t.integration_id AND i.tenant_id=t.tenant_id AND i.facility_id=t.facility_id JOIN payment_provider_definitions p ON p.id=i.provider_id
      WHERE t.provider_request_id=$1 AND p.adapter_key='MPESA_DARAJA' FOR UPDATE OF t`,
      [checkout],
    );
    if (!t.rows.length) return; // Acknowledge unknown identifiers without exposing existence.
    const count = await c.query(
      'SELECT count(*)::int AS count FROM payment_hub_webhook_events WHERE transaction_id=$1',
      [t.rows[0].id],
    );
    if (count.rows[0].count >= 20) return; // Bound untrusted event storage per transaction.
    const r = await c.query(
      `INSERT INTO payment_hub_webhook_events(transaction_id,tenant_id,facility_id,event_hash,result_code) VALUES($1,$2,$3,$4,$5) ON CONFLICT(transaction_id,event_hash) DO NOTHING RETURNING id`,
      [t.rows[0].id, t.rows[0].tenant_id, t.rows[0].facility_id, hash, resultCode],
    );
    if (r.rows.length)
      await c.query(
        `INSERT INTO audit_logs(tenant_id,facility_id,action,resource,resource_id,details) VALUES($1,$2,'RECEIVE','payment_hub.webhook',$3,$4)`,
        [
          t.rows[0].tenant_id,
          t.rows[0].facility_id,
          String(r.rows[0].id),
          JSON.stringify({ verification: 'UNVERIFIED' }),
        ],
      );
  });
  return { received: true };
}
export async function reconcileReceipt(
  scope: HubScope,
  transactionId: number,
  input: Record<string, unknown>,
) {
  numberId(transactionId);
  const paymentId = numberId(input.billingPaymentId),
    verifiedReference = reference(
      input.verifiedReference,
      'Verified provider reference',
    ).toUpperCase(),
    evidence = reference(input.evidenceReference, 'Evidence reference');
  if (input.attested !== true)
    throw new PaymentHubError(
      'ATTESTATION_REQUIRED',
      'Confirm that the provider statement and receipt were independently reviewed.',
    );
  try {
    return await tx(async (c) => {
      const row = await c.query(
        `SELECT t.*,i.environment FROM payment_hub_transactions t JOIN facility_payment_integrations i ON i.id=t.integration_id AND i.tenant_id=t.tenant_id AND i.facility_id=t.facility_id WHERE t.id=$1 AND t.tenant_id=$2 AND t.facility_id=$3 FOR UPDATE OF t`,
        [transactionId, scope.tenantId, scope.facilityId],
      );
      if (!row.rows.length)
        throw new PaymentHubError('TRANSACTION_NOT_FOUND', 'Transaction not found.', 404);
      const t = row.rows[0];
      if (t.environment !== 'PRODUCTION')
        throw new PaymentHubError(
          'SANDBOX_CANNOT_SETTLE',
          'Sandbox requests cannot be reconciled to real receipts.',
          403,
        );
      if (t.status !== 'PROVIDER_CONFIRMED')
        throw new PaymentHubError(
          'TRANSACTION_NOT_CONFIRMED',
          'Only a provider-confirmed transaction may be reviewed for matching.',
          409,
        );
      const p = await c.query(
        `SELECT p.id,p.amount,p.transaction_code,p.invoice_id FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id WHERE p.id=$1 AND i.tenant_id=$2 AND i.facility_id=$3 FOR UPDATE OF p`,
        [paymentId, scope.tenantId, scope.facilityId],
      );
      if (!p.rows.length) throw new PaymentHubError('RECEIPT_NOT_FOUND', 'Receipt not found.', 404);
      if (
        p.rows[0].invoice_id !== t.invoice_id ||
        parseMoneyToCents(p.rows[0].amount) !== Number(t.amount_cents) ||
        String(p.rows[0].transaction_code ?? '').toUpperCase() !== verifiedReference
      )
        throw new PaymentHubError(
          'RECEIPT_MISMATCH',
          'Invoice, amount and independently verified provider reference must match the existing receipt.',
          409,
        );
      const r = await c.query(
        `INSERT INTO payment_hub_reconciliations(transaction_id,tenant_id,facility_id,billing_payment_id,evidence_reference,matched_by_user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [transactionId, scope.tenantId, scope.facilityId, paymentId, evidence, scope.actorUserId],
      );
      await audit(c, scope.actorUserId, scope, 'MATCH', 'reconciliation', r.rows[0].id, {
        transactionId,
        paymentId,
        method: 'MANUAL_REVIEW',
      });
      return { id: r.rows[0].id, status: 'MATCHED', receiptCreated: false, invoiceChanged: false };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new PaymentHubError(
        'ALREADY_RECONCILED',
        'Transaction or receipt already has an active match.',
        409,
      );
    throw error;
  }
}
export async function voidReconciliation(
  scope: HubScope,
  reconciliationId: number,
  reason: unknown,
) {
  numberId(reconciliationId);
  if (reason !== 'WRONG_RECEIPT' && reason !== 'DUPLICATE_REVIEW' && reason !== 'OTHER')
    throw new PaymentHubError('INVALID_INPUT', 'Choose a correction reason.');
  return tx(async (c) => {
    const r = await c.query(
      `UPDATE payment_hub_reconciliations SET status='VOIDED',voided_at=now(),voided_by_user_id=$1 WHERE id=$2 AND tenant_id=$3 AND facility_id=$4 AND status='MATCHED' RETURNING transaction_id,billing_payment_id`,
      [scope.actorUserId, reconciliationId, scope.tenantId, scope.facilityId],
    );
    if (!r.rows.length)
      throw new PaymentHubError(
        'RECONCILIATION_NOT_FOUND',
        'Active reconciliation not found.',
        404,
      );
    await audit(c, scope.actorUserId, scope, 'VOID', 'reconciliation', reconciliationId, {
      reason,
    });
    return { status: 'VOIDED', receiptChanged: false };
  });
}
