/**
 * JaliCare HMIS — Insurer Configuration & Capability Service
 *
 * Manages Britam, PACIS, SmartLink-routed payers, and additional private
 * insurers per facility. Never invents endpoints or exposes secrets.
 */

import { and, asc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  getPayerAdapter,
  inspectSecretEnvPresence,
  isSecureHttpsEndpoint,
  registerPayerAdapter,
} from '../core/adapter-registry.ts';
import {
  PrivateInsuranceError,
  type PayerAdapterKey,
  type PayerAuthMethod,
  type PayerClaimRequirements,
  type PayerConnectionStatus,
  type PayerEnvironment,
  type PayerIntegrationType,
  type PayerPreauthRequirements,
  type PayerRuntimeConfig,
} from '../core/types.ts';
import {
  recordIntegrationDiagnostic,
  recordPrivateInsuranceAudit,
} from '../audit/diagnostics.service.ts';
import { BRITAM_REQUIRED_ONBOARDING_ITEMS, BritamInsuranceAdapter } from './britam.adapter.ts';
import { ManualFilePayerAdapter, ShaPayerBridgeAdapter } from './manual.adapter.ts';
import { PACIS_REQUIRED_ONBOARDING_ITEMS, PacisInsuranceAdapter } from './pacis.adapter.ts';
import { SmartLinkGatewayAdapter } from './smartlink.adapter.ts';

// Register standard independent adapters once at module load
registerPayerAdapter(new BritamInsuranceAdapter());
registerPayerAdapter(new PacisInsuranceAdapter());
registerPayerAdapter(new SmartLinkGatewayAdapter());
registerPayerAdapter(new ManualFilePayerAdapter());
registerPayerAdapter(new ShaPayerBridgeAdapter());

const VALID_INTEGRATION_TYPES = new Set<PayerIntegrationType>([
  'DIRECT_API',
  'THIRD_PARTY_GATEWAY',
  'FILE_EXPORT',
  'MANUAL',
]);

const VALID_ENVIRONMENTS = new Set<PayerEnvironment>(['UNCONFIGURED', 'SANDBOX', 'PRODUCTION']);

const VALID_AUTH_METHODS = new Set<PayerAuthMethod>([
  'NONE',
  'OAUTH2_CLIENT_CREDENTIALS',
  'API_KEY_HEADER',
  'BEARER_TOKEN_REF',
  'MUTUAL_TLS',
]);

const VALID_ADAPTER_KEYS = new Set<PayerAdapterKey>([
  'britam_direct',
  'pacis_direct',
  'smartlink_gateway',
  'sha_afyalink',
  'manual',
]);

export function toPayerRuntimeConfig(
  row: typeof schema.insurancePayerConfigs.$inferSelect,
): PayerRuntimeConfig {
  return {
    payerId: row.id,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    payerCode: row.payerCode,
    payerName: row.payerName,
    payerType: row.payerType,
    integrationType: (row.integrationType as PayerIntegrationType) || 'MANUAL',
    adapterKey: (row.adapterKey as PayerAdapterKey) || 'manual',
    gatewayProvider: row.gatewayProvider ?? null,
    environment: (row.environment as PayerEnvironment) || 'UNCONFIGURED',
    connectionStatus: (row.connectionStatus as PayerConnectionStatus) || 'NOT_CONFIGURED',
    apiBaseUrl: row.apiBaseUrl ?? null,
    authMethod: (row.authMethod as PayerAuthMethod) || 'NONE',
    secretEnvPrefix: row.secretEnvPrefix ?? null,
    providerIdentifier: row.providerIdentifier ?? null,
    defaultCodingSystem: row.defaultCodingSystem || 'ICD-10',
    requireVerifiedEligibility: row.requireVerifiedEligibility,
    eligibilityMaxAgeHours: row.eligibilityMaxAgeHours,
    claimRequirements: (row.claimRequirements ?? {}) as PayerClaimRequirements,
    preauthRequirements: (row.preauthRequirements ?? {}) as PayerPreauthRequirements,
    isActive: row.isActive,
  };
}

/**
 * Formats a payer configuration row for API/UI consumption, stripping any
 * raw secrets and attaching boolean secret-presence indicators + adapter
 * onboarding checklist.
 */
export function serializePayerConfig(row: typeof schema.insurancePayerConfigs.$inferSelect) {
  const runtime = toPayerRuntimeConfig(row);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;
  const capabilities = adapter.getCapabilities(runtime, secrets);
  const onboardingChecklist = adapter.getRequiredOnboardingChecklist(runtime);

  return {
    id: row.id,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    payerCode: row.payerCode,
    payerName: row.payerName,
    payerType: row.payerType,
    isActive: row.isActive,
    integrationType: runtime.integrationType,
    adapterKey: runtime.adapterKey,
    adapterDisplayName: adapter.displayName,
    isGatewayAdapter: adapter.isGatewayAdapter,
    gatewayProvider: runtime.gatewayProvider,
    environment: runtime.environment,
    connectionStatus: runtime.connectionStatus,
    apiBaseUrl: runtime.apiBaseUrl,
    authMethod: runtime.authMethod,
    secretReference: {
      envPrefix: secrets.secretEnvPrefix,
      hasClientId: secrets.hasClientId,
      hasClientSecret: secrets.hasClientSecret,
      hasApiKey: secrets.hasApiKey,
      allRequiredSecretsPresent: secrets.allRequiredSecretsPresent,
    },
    providerIdentifier: runtime.providerIdentifier,
    contractedSchemes: row.contractedSchemes ?? [],
    defaultCodingSystem: runtime.defaultCodingSystem,
    requireVerifiedEligibility: runtime.requireVerifiedEligibility,
    eligibilityMaxAgeHours: runtime.eligibilityMaxAgeHours,
    supportedOperations: capabilities.filter((c) => c.readyInCurrentConfig).map((c) => c.operation),
    capabilities,
    claimRequirements: runtime.claimRequirements,
    preauthRequirements: runtime.preauthRequirements,
    missingRequirements:
      row.missingRequirements && row.missingRequirements.length > 0
        ? row.missingRequirements
        : onboardingChecklist,
    onboardingChecklist,
    lastConnectionCheckAt: row.lastConnectionCheckAt,
    lastConnectionSummary: row.lastConnectionSummary,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

/**
 * Ensures Britam (`BRITAM`) and PACIS (`PACIS`) exist as separate private
 * insurer configurations for the facility with honest `AWAITING_DOCUMENTATION`
 * status until official API specs and credentials are supplied.
 */
export async function ensureDefaultPrivatePayers(
  tenantId: number,
  facilityId: number,
): Promise<void> {
  const existing = await db
    .select({ payerCode: schema.insurancePayerConfigs.payerCode })
    .from(schema.insurancePayerConfigs)
    .where(
      and(
        eq(schema.insurancePayerConfigs.tenantId, tenantId),
        eq(schema.insurancePayerConfigs.facilityId, facilityId),
      ),
    );

  const codes = new Set(existing.map((r) => r.payerCode.toUpperCase()));

  if (!codes.has('BRITAM')) {
    await db
      .insert(schema.insurancePayerConfigs)
      .values({
        tenantId,
        facilityId,
        payerCode: 'BRITAM',
        payerName: 'Britam Insurance (Kenya)',
        payerType: 'PRIVATE_INSURER',
        integrationType: 'MANUAL',
        adapterKey: 'britam_direct',
        gatewayProvider: null,
        environment: 'UNCONFIGURED',
        connectionStatus: 'AWAITING_DOCUMENTATION',
        apiBaseUrl: null,
        authMethod: 'NONE',
        secretEnvPrefix: 'BRITAM_API',
        providerIdentifier: null,
        contractedSchemes: ['Britam Corporate Medical', 'Milele Health', 'Bima ya Wafanyikazi'],
        defaultCodingSystem: 'ICD-10',
        requireVerifiedEligibility: true,
        eligibilityMaxAgeHours: 24,
        supportedOperations: [],
        claimRequirements: {
          requireMemberNumber: true,
          requirePolicyNumber: false,
          requireDiagnosis: true,
          requireInvoiceAttachment: true,
          requireSignedClaimForm: true,
          maxSubmissionDays: 90,
          // Require explicit payer-approved coding policy before submission.
          allowedCodingSystems: [],
          codingPolicyVerified: false,
        },
        preauthRequirements: {
          requirePreauthForInpatient: true,
          requirePreauthForImaging: true,
          requirePreauthForSurgery: true,
          requirePreauthForOptical: true,
          requirePreauthForDental: true,
          amountThresholdKes: 20000,
        },
        missingRequirements: [...BRITAM_REQUIRED_ONBOARDING_ITEMS],
        lastConnectionSummary:
          'Awaiting official Britam technical API specification and provider panel credentials. Internal membership, manual verification, preauthorization, invoice-claim preparation, and remittance workflows are active.',
        isActive: true,
      })
      .onConflictDoNothing();
  }

  if (!codes.has('PACIS')) {
    await db
      .insert(schema.insurancePayerConfigs)
      .values({
        tenantId,
        facilityId,
        payerCode: 'PACIS',
        payerName: 'PACIS Insurance Company Ltd',
        payerType: 'PRIVATE_INSURER',
        integrationType: 'MANUAL',
        adapterKey: 'pacis_direct',
        gatewayProvider: null,
        environment: 'UNCONFIGURED',
        connectionStatus: 'AWAITING_DOCUMENTATION',
        apiBaseUrl: null,
        authMethod: 'NONE',
        secretEnvPrefix: 'PACIS_API',
        providerIdentifier: null,
        contractedSchemes: [
          'PACIS Corporate Medical',
          'PACIS Family Medical',
          'PACIS Micro-Medical',
        ],
        defaultCodingSystem: 'ICD-10',
        requireVerifiedEligibility: true,
        eligibilityMaxAgeHours: 24,
        supportedOperations: [],
        claimRequirements: {
          requireMemberNumber: true,
          requirePolicyNumber: true,
          requireDiagnosis: true,
          requireInvoiceAttachment: true,
          requireSignedClaimForm: true,
          maxSubmissionDays: 60,
          // Require explicit payer-approved coding policy before submission.
          allowedCodingSystems: [],
          codingPolicyVerified: false,
        },
        preauthRequirements: {
          requirePreauthForInpatient: true,
          requirePreauthForImaging: true,
          requirePreauthForSurgery: true,
          requirePreauthForOptical: true,
          requirePreauthForDental: true,
          amountThresholdKes: 15000,
        },
        missingRequirements: [...PACIS_REQUIRED_ONBOARDING_ITEMS],
        lastConnectionSummary:
          'Awaiting official PACIS technical API specification or designated electronic claims aggregator authorization. Internal membership, manual verification, preauthorization, invoice-claim preparation, and remittance workflows are active.',
        isActive: true,
      })
      .onConflictDoNothing();
  }
}

export async function listPrivatePayers(params: {
  tenantId: number;
  facilityId: number;
  includePublicSha?: boolean;
}) {
  await ensureDefaultPrivatePayers(params.tenantId, params.facilityId);

  const conditions = [
    eq(schema.insurancePayerConfigs.tenantId, params.tenantId),
    eq(schema.insurancePayerConfigs.facilityId, params.facilityId),
  ];
  if (!params.includePublicSha) {
    conditions.push(ne(schema.insurancePayerConfigs.payerCode, 'SHA'));
  }

  const rows = await db
    .select()
    .from(schema.insurancePayerConfigs)
    .where(and(...conditions))
    .orderBy(asc(schema.insurancePayerConfigs.payerCode));

  return rows.map(serializePayerConfig);
}

export async function getPayerRowScoped(params: {
  tenantId: number;
  facilityId: number;
  payerId?: number;
  payerCode?: string;
}) {
  await ensureDefaultPrivatePayers(params.tenantId, params.facilityId);

  const conditions = [
    eq(schema.insurancePayerConfigs.tenantId, params.tenantId),
    eq(schema.insurancePayerConfigs.facilityId, params.facilityId),
  ];
  if (params.payerId !== undefined) {
    conditions.push(eq(schema.insurancePayerConfigs.id, params.payerId));
  } else if (params.payerCode) {
    conditions.push(
      eq(schema.insurancePayerConfigs.payerCode, params.payerCode.trim().toUpperCase()),
    );
  } else {
    throw new PrivateInsuranceError(
      'PAYER_IDENTIFIER_REQUIRED',
      'payerId or payerCode is required.',
      400,
    );
  }

  const [row] = await db
    .select()
    .from(schema.insurancePayerConfigs)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    throw new PrivateInsuranceError(
      'PAYER_NOT_FOUND',
      'Configured insurer was not found for this facility.',
      404,
    );
  }
  return row;
}

function validatePayerConfigMutation(input: Record<string, unknown>) {
  if (input.integrationType !== undefined) {
    if (!VALID_INTEGRATION_TYPES.has(input.integrationType as PayerIntegrationType)) {
      throw new PrivateInsuranceError(
        'INVALID_INTEGRATION_TYPE',
        'integrationType must be DIRECT_API, THIRD_PARTY_GATEWAY, FILE_EXPORT, or MANUAL.',
        400,
      );
    }
  }
  if (input.environment !== undefined) {
    if (!VALID_ENVIRONMENTS.has(input.environment as PayerEnvironment)) {
      throw new PrivateInsuranceError(
        'INVALID_ENVIRONMENT',
        'environment must be UNCONFIGURED, SANDBOX, or PRODUCTION.',
        400,
      );
    }
  }
  if (input.authMethod !== undefined) {
    if (!VALID_AUTH_METHODS.has(input.authMethod as PayerAuthMethod)) {
      throw new PrivateInsuranceError('INVALID_AUTH_METHOD', 'Unsupported authMethod value.', 400);
    }
  }
  if (input.adapterKey !== undefined) {
    if (!VALID_ADAPTER_KEYS.has(input.adapterKey as PayerAdapterKey)) {
      throw new PrivateInsuranceError(
        'INVALID_ADAPTER_KEY',
        'adapterKey must be britam_direct, pacis_direct, smartlink_gateway, sha_afyalink, or manual.',
        400,
      );
    }
  }
  if (
    input.apiBaseUrl !== undefined &&
    input.apiBaseUrl !== null &&
    String(input.apiBaseUrl).trim() !== ''
  ) {
    if (!isSecureHttpsEndpoint(String(input.apiBaseUrl))) {
      throw new PrivateInsuranceError(
        'INSECURE_API_BASE_URL',
        'apiBaseUrl must be a valid https:// URL supplied by the authorized insurer or gateway.',
        400,
      );
    }
  }
  // Reject any attempt to pass raw secrets into database configuration
  for (const forbidden of ['clientSecret', 'apiKey', 'bearerToken', 'password', 'privateKey']) {
    if (input[forbidden] !== undefined && String(input[forbidden]).trim() !== '') {
      throw new PrivateInsuranceError(
        'RAW_SECRET_FORBIDDEN',
        `Do not submit raw "${forbidden}" in configuration payloads. Provision secrets in server environment variables and set secretEnvPrefix only.`,
        400,
      );
    }
  }
}

export async function createPrivatePayer(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  validatePayerConfigMutation(params.input);

  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  const payerName = String(params.input.payerName ?? '').trim();
  if (!payerCode || !/^[A-Z0-9_-]{2,24}$/.test(payerCode)) {
    throw new PrivateInsuranceError(
      'INVALID_PAYER_CODE',
      'payerCode must be 2–24 uppercase alphanumeric characters.',
      400,
    );
  }
  if (!payerName) {
    throw new PrivateInsuranceError('INVALID_PAYER_NAME', 'payerName is required.', 400);
  }

  const adapterKey = (params.input.adapterKey as PayerAdapterKey) ?? 'manual';
  let integrationType = (params.input.integrationType as PayerIntegrationType) ?? 'MANUAL';
  let gatewayProvider =
    typeof params.input.gatewayProvider === 'string' && params.input.gatewayProvider.trim()
      ? params.input.gatewayProvider.trim()
      : null;

  if (adapterKey === 'smartlink_gateway') {
    if (integrationType === 'DIRECT_API') {
      throw new PrivateInsuranceError(
        'GATEWAY_MISLABELLED_AS_DIRECT',
        'SmartLink is a third-party EDI gateway and cannot be configured with integrationType DIRECT_API. Use THIRD_PARTY_GATEWAY.',
        400,
      );
    }
    integrationType = 'THIRD_PARTY_GATEWAY';
    gatewayProvider = gatewayProvider ?? 'SMARTLINK';
  }

  const environment = (params.input.environment as PayerEnvironment) ?? 'UNCONFIGURED';
  const authMethod = (params.input.authMethod as PayerAuthMethod) ?? 'NONE';
  const secretEnvPrefix =
    typeof params.input.secretEnvPrefix === 'string' && params.input.secretEnvPrefix.trim()
      ? params.input.secretEnvPrefix.trim().toUpperCase()
      : `${payerCode.replace(/[^A-Z0-9]/g, '_')}_API`;

  const apiBaseUrl =
    typeof params.input.apiBaseUrl === 'string' && params.input.apiBaseUrl.trim()
      ? params.input.apiBaseUrl.trim()
      : null;

  const [created] = await db
    .insert(schema.insurancePayerConfigs)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode,
      payerName,
      payerType: 'PRIVATE_INSURER',
      integrationType,
      adapterKey,
      gatewayProvider,
      environment,
      connectionStatus: apiBaseUrl ? 'AWAITING_DOCUMENTATION' : 'NOT_CONFIGURED',
      apiBaseUrl,
      authMethod,
      secretEnvPrefix,
      providerIdentifier:
        typeof params.input.providerIdentifier === 'string' &&
        params.input.providerIdentifier.trim()
          ? params.input.providerIdentifier.trim()
          : null,
      contractedSchemes: Array.isArray(params.input.contractedSchemes)
        ? params.input.contractedSchemes.map(String)
        : [],
      defaultCodingSystem:
        typeof params.input.defaultCodingSystem === 'string' &&
        params.input.defaultCodingSystem.trim()
          ? params.input.defaultCodingSystem.trim()
          : 'ICD-10',
      requireVerifiedEligibility:
        typeof params.input.requireVerifiedEligibility === 'boolean'
          ? params.input.requireVerifiedEligibility
          : true,
      eligibilityMaxAgeHours:
        typeof params.input.eligibilityMaxAgeHours === 'number'
          ? Math.max(1, Math.trunc(params.input.eligibilityMaxAgeHours))
          : 24,
      claimRequirements:
        params.input.claimRequirements && typeof params.input.claimRequirements === 'object'
          ? (params.input.claimRequirements as Record<string, unknown>)
          : { requireMemberNumber: true, requireDiagnosis: true },
      preauthRequirements:
        params.input.preauthRequirements && typeof params.input.preauthRequirements === 'object'
          ? (params.input.preauthRequirements as Record<string, unknown>)
          : {},
      isActive: params.input.isActive !== false,
      notes: typeof params.input.notes === 'string' ? params.input.notes : null,
      updatedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_PAYER_CREATED',
    entityType: 'insurance_payer_config',
    entityId: created.id,
    details: {
      payerCode: created.payerCode,
      integrationType: created.integrationType,
      adapterKey: created.adapterKey,
      environment: created.environment,
    },
  });

  return serializePayerConfig(created);
}

export async function updatePrivatePayer(params: {
  tenantId: number;
  facilityId: number;
  payerId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  validatePayerConfigMutation(params.input);

  const existing = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerId: params.payerId,
  });

  const nextAdapterKey =
    (params.input.adapterKey as PayerAdapterKey | undefined) ??
    (existing.adapterKey as PayerAdapterKey);
  const nextIntegrationType =
    (params.input.integrationType as PayerIntegrationType | undefined) ??
    (existing.integrationType as PayerIntegrationType);

  if (nextAdapterKey === 'smartlink_gateway' && nextIntegrationType === 'DIRECT_API') {
    throw new PrivateInsuranceError(
      'GATEWAY_MISLABELLED_AS_DIRECT',
      'SmartLink is a third-party EDI gateway and cannot be described as a direct insurer API. Use integrationType THIRD_PARTY_GATEWAY.',
      400,
    );
  }

  const updates: Partial<typeof schema.insurancePayerConfigs.$inferInsert> = {
    updatedByUserId: params.actorUserId,
    updatedAt: new Date(),
  };

  if (typeof params.input.payerName === 'string' && params.input.payerName.trim()) {
    updates.payerName = params.input.payerName.trim();
  }
  if (typeof params.input.isActive === 'boolean') {
    updates.isActive = params.input.isActive;
  }
  if (params.input.integrationType !== undefined) {
    updates.integrationType = nextIntegrationType;
  }
  if (params.input.adapterKey !== undefined) {
    updates.adapterKey = nextAdapterKey;
    if (nextAdapterKey === 'smartlink_gateway') {
      updates.gatewayProvider = 'SMARTLINK';
    }
  }
  if (params.input.gatewayProvider !== undefined) {
    updates.gatewayProvider =
      typeof params.input.gatewayProvider === 'string' && params.input.gatewayProvider.trim()
        ? params.input.gatewayProvider.trim()
        : null;
  }
  if (params.input.environment !== undefined) {
    updates.environment = params.input.environment as string;
  }
  if (params.input.apiBaseUrl !== undefined) {
    updates.apiBaseUrl =
      params.input.apiBaseUrl && String(params.input.apiBaseUrl).trim()
        ? String(params.input.apiBaseUrl).trim()
        : null;
  }
  if (params.input.authMethod !== undefined) {
    updates.authMethod = params.input.authMethod as string;
  }
  if (params.input.secretEnvPrefix !== undefined) {
    updates.secretEnvPrefix =
      params.input.secretEnvPrefix && String(params.input.secretEnvPrefix).trim()
        ? String(params.input.secretEnvPrefix).trim().toUpperCase()
        : null;
  }
  if (params.input.providerIdentifier !== undefined) {
    updates.providerIdentifier =
      params.input.providerIdentifier && String(params.input.providerIdentifier).trim()
        ? String(params.input.providerIdentifier).trim()
        : null;
  }
  if (Array.isArray(params.input.contractedSchemes)) {
    updates.contractedSchemes = params.input.contractedSchemes.map(String);
  }
  if (
    typeof params.input.defaultCodingSystem === 'string' &&
    params.input.defaultCodingSystem.trim()
  ) {
    updates.defaultCodingSystem = params.input.defaultCodingSystem.trim();
  }
  if (typeof params.input.requireVerifiedEligibility === 'boolean') {
    updates.requireVerifiedEligibility = params.input.requireVerifiedEligibility;
  }
  if (typeof params.input.eligibilityMaxAgeHours === 'number') {
    updates.eligibilityMaxAgeHours = Math.max(1, Math.trunc(params.input.eligibilityMaxAgeHours));
  }
  if (params.input.claimRequirements && typeof params.input.claimRequirements === 'object') {
    updates.claimRequirements = {
      ...(existing.claimRequirements ?? {}),
      ...(params.input.claimRequirements as Record<string, unknown>),
    };
  }
  if (params.input.preauthRequirements && typeof params.input.preauthRequirements === 'object') {
    updates.preauthRequirements = {
      ...(existing.preauthRequirements ?? {}),
      ...(params.input.preauthRequirements as Record<string, unknown>),
    };
  }
  if (params.input.notes !== undefined) {
    updates.notes = typeof params.input.notes === 'string' ? params.input.notes : null;
  }

  const [updated] = await db
    .update(schema.insurancePayerConfigs)
    .set(updates)
    .where(eq(schema.insurancePayerConfigs.id, existing.id))
    .returning();

  // Re-probe connection honesty after configuration update
  const runtime = toPayerRuntimeConfig(updated);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;
  const probe = await adapter.probeConnection(runtime, secrets);

  const [finalRow] = await db
    .update(schema.insurancePayerConfigs)
    .set({
      connectionStatus: probe.connectionStatus,
      lastConnectionCheckAt: new Date(),
      lastConnectionSummary: probe.summary,
      missingRequirements: probe.missingRequirements,
      supportedOperations: adapter
        .getCapabilities(runtime, secrets)
        .filter((c) => c.readyInCurrentConfig)
        .map((c) => c.operation),
    })
    .where(eq(schema.insurancePayerConfigs.id, updated.id))
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_PAYER_UPDATED',
    entityType: 'insurance_payer_config',
    entityId: finalRow.id,
    details: {
      payerCode: finalRow.payerCode,
      integrationType: finalRow.integrationType,
      adapterKey: finalRow.adapterKey,
      environment: finalRow.environment,
      connectionStatus: finalRow.connectionStatus,
    },
  });

  return serializePayerConfig(finalRow);
}

export async function getPayerCapabilitiesScoped(params: {
  tenantId: number;
  facilityId: number;
  payerId: number;
}) {
  const row = await getPayerRowScoped(params);
  const runtime = toPayerRuntimeConfig(row);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;
  return {
    payerId: row.id,
    payerCode: row.payerCode,
    payerName: row.payerName,
    integrationType: runtime.integrationType,
    adapterKey: runtime.adapterKey,
    adapterDisplayName: adapter.displayName,
    isGatewayAdapter: adapter.isGatewayAdapter,
    environment: runtime.environment,
    connectionStatus: runtime.connectionStatus,
    capabilities: adapter.getCapabilities(runtime, secrets),
    onboardingChecklist: adapter.getRequiredOnboardingChecklist(runtime),
  };
}

export async function probeAndPersistPayerConnectionStatus(params: {
  tenantId: number;
  facilityId: number;
  payerId: number;
  actorUserId?: number | null;
}) {
  const row = await getPayerRowScoped(params);
  const runtime = toPayerRuntimeConfig(row);
  const secrets = inspectSecretEnvPresence(runtime.secretEnvPrefix, runtime.authMethod);
  const adapter = getPayerAdapter(runtime.adapterKey) ?? getPayerAdapter('manual')!;
  const correlationId = randomUUID();
  const probe = await adapter.probeConnection(runtime, secrets);

  const [updated] = await db
    .update(schema.insurancePayerConfigs)
    .set({
      connectionStatus: probe.connectionStatus,
      lastConnectionCheckAt: new Date(),
      lastConnectionSummary: probe.summary,
      missingRequirements: probe.missingRequirements,
      updatedAt: new Date(),
    })
    .where(eq(schema.insurancePayerConfigs.id, row.id))
    .returning();

  await recordIntegrationDiagnostic({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode: row.payerCode,
    adapterKey: runtime.adapterKey,
    environment: runtime.environment,
    operation: 'CONNECTION_STATUS_PROBE',
    direction: 'INTERNAL',
    outcome: probe.connectionStatus,
    httpStatus: probe.httpStatus,
    durationMs: probe.durationMs,
    correlationId,
    summary: probe.summary,
    actorUserId: params.actorUserId ?? null,
  });

  return {
    payerId: updated.id,
    payerCode: updated.payerCode,
    payerName: updated.payerName,
    integrationType: runtime.integrationType,
    adapterKey: runtime.adapterKey,
    isGatewayAdapter: adapter.isGatewayAdapter,
    environment: runtime.environment,
    verified: probe.verified,
    connectionStatus: probe.connectionStatus,
    checkedAt: updated.lastConnectionCheckAt,
    summary: probe.summary,
    missingRequirements: probe.missingRequirements,
    secretReference: {
      envPrefix: secrets.secretEnvPrefix,
      allRequiredSecretsPresent: secrets.allRequiredSecretsPresent,
    },
  };
}
