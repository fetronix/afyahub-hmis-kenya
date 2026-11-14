/** SHA gateway concern: client registry. */
import { randomUUID } from 'node:crypto';
import { maskIdentifier } from '../dha/dha.eligibility.ts';
import { asObj, readStr, normalizeIsoDate } from './sha.values.ts';
import type { ShaGatewayContext } from './sha.context.ts';
import type { ClientRegistrySearchRequest, ClientRegistrySearchResult } from './sha.types.ts';

/**
 * Maps internal JaliCare identifier enumerations to exact DHA HIE Client Registry /
 * Eligibility query parameter values (`ClientRegistry ID`, `National ID`, `Birth Notification`,
 * `Birth Certificate`, `Alien ID`, `Refugee ID`, `Mandate Number`).
 */
export function mapToHieIdentificationType(
  rawType: string,
  identificationValue?: string | null,
): string {
  const upper = rawType.trim().toUpperCase();
  if (upper === 'CLIENT_REGISTRY_ID' || upper === 'CR_NUMBER' || upper === 'CLIENTREGISTRY ID') {
    return 'ClientRegistry ID';
  }
  if (upper === 'NATIONAL_ID' || upper === 'NATIONAL ID') return 'National ID';
  if (upper === 'BIRTH_NOTIFICATION' || upper === 'BIRTH NOTIFICATION') {
    return 'Birth Notification';
  }
  if (upper === 'BIRTH_CERTIFICATE' || upper === 'BIRTH CERTIFICATE') return 'Birth Certificate';
  if (upper === 'ALIEN_ID' || upper === 'ALIEN ID') return 'Alien ID';
  if (upper === 'REFUGEE_ID' || upper === 'REFUGEE ID') return 'Refugee ID';
  if (upper === 'MANDATE_NUMBER' || upper === 'MANDATE NUMBER') return 'Mandate Number';
  if (upper === 'SHA_NUMBER') {
    if (identificationValue && /^CR/i.test(identificationValue.trim())) {
      return 'ClientRegistry ID';
    }
    return 'ClientRegistry ID';
  }
  return rawType.trim();
}

export async function searchClientRegistryPatient(
  context: ShaGatewayContext,
  req: ClientRegistrySearchRequest,
): Promise<ClientRegistrySearchResult> {
  const cfg = context.resolveConfig(req.facilityRegistryOverride);
  const correlationId = req.correlationId ?? randomUUID();
  const trimmed = req.identificationValue.trim();
  const started = Date.now();

  if (cfg.mode === 'mock') {
    const isNotFound = trimmed.endsWith('4040');
    const isDeceased = trimmed.endsWith('6666');
    const crId = isNotFound ? null : `CR${trimmed.replace(/\D/g, '').padStart(10, '2')}-1`;
    const result: ClientRegistrySearchResult = isNotFound
      ? {
          found: false,
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          crId: null,
          fullName: null,
          firstName: null,
          lastName: null,
          gender: null,
          dateOfBirth: null,
          isAlive: null,
          deceasedDateTime: null,
          citizenship: null,
          county: null,
          subCounty: null,
          preferredPrimaryCareNetwork: null,
          errorMessage: 'Simulated Client Registry response: no matching patient profile found.',
          correlationId,
        }
      : {
          found: true,
          source: 'SANDBOX_SIMULATION',
          mode: 'mock',
          isSimulated: true,
          crId,
          fullName: 'SIMULATED BENEFICIARY',
          firstName: 'SIMULATED',
          lastName: 'BENEFICIARY',
          gender: 'female',
          dateOfBirth: '1990-05-14',
          isAlive: !isDeceased,
          deceasedDateTime: isDeceased ? '2026-02-10T08:00:00Z' : null,
          citizenship: 'KE',
          county: 'NYERI',
          subCounty: 'NYERI CENTRAL',
          preferredPrimaryCareNetwork: 'NYERI CENTRAL PCN',
          errorMessage: null,
          correlationId,
        };

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'registry.patient_search',
      mode: 'mock',
      httpMethod: 'GET',
      endpointPath: cfg.clientRegistryPath,
      subjectHint: maskIdentifier(trimmed),
      httpStatus: isNotFound ? 404 : 200,
      outcome: result.found ? 'FOUND' : 'NOT_FOUND',
      durationMs: Date.now() - started,
    });

    return result;
  }

  if (!cfg.enabled || !cfg.middlewareBaseUrl) {
    return {
      found: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      crId: null,
      fullName: null,
      firstName: null,
      lastName: null,
      gender: null,
      dateOfBirth: null,
      isAlive: null,
      deceasedDateTime: null,
      citizenship: null,
      county: null,
      subCounty: null,
      preferredPrimaryCareNetwork: null,
      errorMessage: cfg.disabledReason ?? 'SHA Client Registry credentials are not configured.',
      correlationId,
    };
  }

  try {
    const token = await context.obtainAccessToken(cfg, correlationId);
    const url = new URL(`${cfg.middlewareBaseUrl}${cfg.clientRegistryPath}`);
    url.searchParams.set(
      'identification_type',
      mapToHieIdentificationType(req.identificationType, trimmed),
    );
    url.searchParams.set('identification_number', trimmed);

    const response = await context.fetchGetWithBoundedRetry(
      url.toString(),
      context.buildServiceAccountHeaders(cfg, token, correlationId),
      cfg.timeoutMs,
      cfg.maxGetRetries,
    );

    const rawJson = await response.json().catch(() => null);
    const json = asObj(rawJson);
    const firstFromArray = Array.isArray(rawJson)
      ? asObj(rawJson[0])
      : json && Array.isArray(json.patients)
        ? asObj(json.patients[0])
        : json && Array.isArray(json.data)
          ? asObj(json.data[0])
          : null;
    const payload = firstFromArray ?? (json ? (asObj(json.data) ?? json) : null);
    const crId = payload ? readStr(payload, 'id', 'cr_id', 'memberCrNumber') : null;
    const deceasedDt = payload ? readStr(payload, 'deceased_datetime', 'deceasedDateTime') : null;

    await context.logGatewayCall({
      tenantId: req.tenantId,
      facilityId: req.facilityId,
      actorUserId: req.actorUserId,
      correlationId,
      operation: 'registry.patient_search',
      mode: cfg.mode,
      httpMethod: 'GET',
      endpointPath: cfg.clientRegistryPath,
      subjectHint: maskIdentifier(trimmed),
      httpStatus: response.status,
      outcome: response.ok && crId ? 'FOUND' : 'NOT_FOUND',
      durationMs: Date.now() - started,
    });

    if (!response.ok || !payload || !crId) {
      return {
        found: false,
        source: response.status >= 500 ? 'UNAVAILABLE' : 'AUTHORITATIVE_PAYER',
        mode: cfg.mode,
        isSimulated: false,
        crId: null,
        fullName: null,
        firstName: null,
        lastName: null,
        gender: null,
        dateOfBirth: null,
        isAlive: null,
        deceasedDateTime: null,
        citizenship: null,
        county: null,
        subCounty: null,
        preferredPrimaryCareNetwork: null,
        errorMessage:
          (payload && readStr(payload, 'message', 'detail')) ??
          `Client Registry lookup returned HTTP ${response.status}.`,
        correlationId,
      };
    }

    const firstName = readStr(payload, 'first_name', 'firstName');
    const middleName = readStr(payload, 'middle_name', 'middleName');
    const lastName = readStr(payload, 'last_name', 'lastName');

    return {
      found: true,
      source: 'AUTHORITATIVE_PAYER',
      mode: cfg.mode,
      isSimulated: false,
      crId,
      fullName:
        [firstName, middleName, lastName].filter(Boolean).join(' ') || readStr(payload, 'fullName'),
      firstName,
      lastName,
      gender: readStr(payload, 'gender'),
      dateOfBirth: normalizeIsoDate(readStr(payload, 'date_of_birth', 'dateOfBirth')),
      isAlive: deceasedDt ? false : true,
      deceasedDateTime: deceasedDt,
      citizenship: readStr(payload, 'citizenship'),
      county: readStr(payload, 'county'),
      subCounty: readStr(payload, 'sub_county', 'subCounty'),
      preferredPrimaryCareNetwork: readStr(
        payload,
        'preferred_primary_care_network',
        'preferredPrimaryCareNetwork',
      ),
      errorMessage: null,
      correlationId,
    };
  } catch (error) {
    return {
      found: false,
      source: 'UNAVAILABLE',
      mode: cfg.mode,
      isSimulated: false,
      crId: null,
      fullName: null,
      firstName: null,
      lastName: null,
      gender: null,
      dateOfBirth: null,
      isAlive: null,
      deceasedDateTime: null,
      citizenship: null,
      county: null,
      subCounty: null,
      preferredPrimaryCareNetwork: null,
      errorMessage:
        error instanceof Error
          ? `Client Registry unreachable: ${error.message}`
          : 'Client Registry unreachable.',
      correlationId,
    };
  }
}
