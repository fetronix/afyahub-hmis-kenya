import { pool } from '../../db/index.ts';

export type HubAuditDomain = 'payment' | 'payer';

/**
 * A bounded, facility-scoped configuration history. Deliberately exclude
 * arbitrary audit details, clinical/finance activity, and credential material.
 */
export async function listConfigurationAudit(
  scope: { tenantId: number; facilityId: number },
  domain: HubAuditDomain,
) {
  const resources =
    domain === 'payment'
      ? [
          'payment_hub.credentials',
          'payment_hub.integration',
          'payment_hub.access',
          'payment_hub.account',
          'payment_hub.assignment',
          'payment_hub.production_approval',
        ]
      : [
          'payer_hub.access',
          'payer_hub.assignment',
          'payer_hub.facility_config',
          'payer_hub.environment',
          'payer_hub.connection',
          'payer_hub.production_approval',
        ];
  const result = await pool.query(
    `SELECT id,action,resource,resource_id AS "resourceId",user_id AS "actorUserId",timestamp
     FROM audit_logs
     WHERE tenant_id=$1 AND facility_id=$2 AND resource = ANY($3::text[])
     ORDER BY timestamp DESC,id DESC LIMIT 100`,
    [scope.tenantId, scope.facilityId, resources],
  );
  return result.rows;
}
