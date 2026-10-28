/**
 * WHO ICD-11 MMS search and diagnosis coding.
 *
 * The cache contains only results fetched from WHO's API. It is deliberately
 * not a complete offline catalogue. No credentials, patient data or search
 * terms are logged, and API failures never mutate existing diagnoses.
 */
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  ICD10_SYSTEM_URI,
  WHO_ICD11_API_BASE,
  WHO_ICD11_DEFAULT_RELEASE,
  WHO_ICD11_SYSTEM_URI,
  WHO_ICD11_TOKEN_URL,
} from './who-icd11-reference.ts';

export interface Icd11CatalogueRecord {
  code: string;
  title: string;
  releaseId: string;
  foundationUri: string | null;
  linearizationUri: string | null;
  chapterCode: string | null;
  keywords: string[];
  isActive: boolean;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: Date;
}

export class Icd11Error extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'Icd11Error';
  }
}

export function getWhoRelease(env: NodeJS.ProcessEnv = process.env): string {
  const release = env.WHO_ICD11_RELEASE_ID?.trim() || WHO_ICD11_DEFAULT_RELEASE;
  if (!/^\d{4}-\d{2}$/.test(release)) {
    throw new Icd11Error(
      'WHO_RELEASE_INVALID',
      'WHO_ICD11_RELEASE_ID must be a WHO release in YYYY-MM format.',
      503,
    );
  }
  return release;
}

export function describeWhoIcd11Configuration(env: NodeJS.ProcessEnv = process.env) {
  const configured = Boolean(
    env.WHO_ICD11_CLIENT_ID?.trim() && env.WHO_ICD11_CLIENT_SECRET?.trim(),
  );
  return {
    credentialsConfigured: configured,
    releaseId: getWhoRelease(env),
    source: 'WHO ICD API v2, MMS',
    apiDocumentation: 'https://icd.who.int/icdapi',
    // Credentials present is intentionally not a connection or data-availability test.
    connectionVerified: false,
    cacheNotice:
      'Cached WHO search results are a partial cache, not a complete ICD-11 catalogue. Availability depends on WHO access and previously cached results.',
  };
}

// This validates only a conservative URL-safe shape. WHO remains the
// authority for whether a code exists and is valid in a particular release.
export function isPlausibleIcd11Code(value: string): boolean {
  return value.length > 0 && value.length <= 80 && /^[A-Z0-9.\-/&]+$/i.test(value);
}

function plainWhoTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** Parse only WHO search results that carry a code and a display title. */
export function parseWhoSearchResults(
  payload: unknown,
  release: string,
  fetchedAt: Date,
): Icd11CatalogueRecord[] {
  if (!payload || typeof payload !== 'object') {
    throw new Icd11Error('WHO_RESPONSE_INVALID', 'WHO returned an invalid search response.', 503);
  }
  const data = payload as { destinationEntities?: unknown; error?: unknown };
  if (data.error === true || !Array.isArray(data.destinationEntities)) {
    throw new Icd11Error('WHO_RESPONSE_INVALID', 'WHO returned an invalid search response.', 503);
  }
  const result: Icd11CatalogueRecord[] = [];
  for (const value of data.destinationEntities.slice(0, 50)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const code = typeof item.theCode === 'string' ? item.theCode.trim().toUpperCase() : '';
    const title = typeof item.title === 'string' ? plainWhoTitle(item.title) : '';
    if (!isPlausibleIcd11Code(code) || !title) continue;
    const matches = Array.isArray(item.matchingPVs) ? item.matchingPVs : [];
    const keywords = matches
      .slice(0, 20)
      .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>).label : null))
      .filter((v): v is string => typeof v === 'string')
      .map(plainWhoTitle)
      .filter(Boolean);
    const id = typeof item.id === 'string' ? item.id : null;
    const foundation = typeof item.foundationUri === 'string' ? item.foundationUri : null;
    result.push({
      code,
      title,
      releaseId: release,
      // WHO may return a foundation or linearization URI in `id`; do not
      // relabel it without knowing which it is.
      foundationUri: foundation ?? (id?.includes('/icd/entity/') ? id : null),
      linearizationUri: id?.includes('/icd/release/') ? id : null,
      chapterCode: typeof item.chapter === 'string' ? item.chapter.slice(0, 20) : null,
      keywords,
      isActive: true,
      sourceName: 'WHO ICD API v2 MMS search',
      sourceUrl: `${WHO_ICD11_API_BASE}/release/11/${release}/mms`,
      fetchedAt,
    });
  }
  return result;
}

let tokenCache: { clientId: string; token: string; expiresAt: number } | null = null;

export function resetWhoTokenForTests(): void {
  tokenCache = null;
}

async function whoToken(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Promise<string> {
  const clientId = env.WHO_ICD11_CLIENT_ID?.trim();
  const clientSecret = env.WHO_ICD11_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Icd11Error('WHO_NOT_CONFIGURED', 'WHO ICD API credentials are not configured.', 503);
  }
  if (
    tokenCache &&
    tokenCache.clientId === clientId &&
    tokenCache.expiresAt > Date.now() + 30_000
  ) {
    return tokenCache.token;
  }
  try {
    const response = await fetchImpl(WHO_ICD11_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'icdapi_access',
      }).toString(),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('token request failed');
    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || !payload.access_token)
      throw new Error('invalid token response');
    const ttl = typeof payload.expires_in === 'number' ? payload.expires_in : 300;
    tokenCache = {
      clientId,
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(30, Math.min(ttl, 3600)) * 1000,
    };
    return payload.access_token;
  } catch {
    // Do not expose upstream bodies, URLs, credentials, or access tokens.
    throw new Icd11Error('WHO_UNAVAILABLE', 'WHO ICD API authentication is unavailable.', 503);
  }
}

export async function fetchWhoSearch(
  query: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<Icd11CatalogueRecord[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    throw new Icd11Error('INVALID_SEARCH', 'Search must contain 2–100 characters.');
  }
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const release = getWhoRelease(env);
  const token = await whoToken(env, fetchImpl);
  const url = new URL(`${WHO_ICD11_API_BASE}/release/11/${release}/mms/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('flatResults', 'true');
  url.searchParams.set('highlightingEnabled', 'false');
  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'accept-language': 'en',
        'API-Version': 'v2',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('search failed');
    return parseWhoSearchResults(await response.json(), release, new Date());
  } catch (error) {
    if (error instanceof Icd11Error) throw error;
    throw new Icd11Error('WHO_UNAVAILABLE', 'WHO ICD API search is unavailable.', 503);
  }
}

/** Search the selected WHO release, falling back only to previously cached WHO results. */
export async function searchIcd11Catalogue(query: string, limit = 25) {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    throw new Icd11Error('INVALID_SEARCH', 'Search must contain 2–100 characters.');
  }
  const releaseId = getWhoRelease();
  const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 25;
  let warning: string | null = null;
  let source: 'WHO_LIVE_API' | 'CACHE' = 'CACHE';
  try {
    const live = await fetchWhoSearch(q);
    // A successful API response is persisted before it can be selected, so a
    // diagnosis can always retain the source and release of the selected code.
    for (const item of live) {
      await db
        .insert(schema.icd11CatalogueEntries)
        .values({
          ...item,
          chapterTitle: null,
          classKind: 'WHO_MMS_SEARCH_RESULT',
          cachedFromWhoApi: true,
          isNotifiable: false,
        })
        .onConflictDoUpdate({
          target: [schema.icd11CatalogueEntries.code, schema.icd11CatalogueEntries.releaseId],
          set: {
            title: item.title,
            foundationUri: item.foundationUri,
            linearizationUri: item.linearizationUri,
            chapterCode: item.chapterCode,
            keywords: item.keywords,
            sourceName: item.sourceName,
            sourceUrl: item.sourceUrl,
            cachedFromWhoApi: true,
            isActive: true,
            fetchedAt: item.fetchedAt,
            updatedAt: new Date(),
          },
        });
    }
    source = 'WHO_LIVE_API';
    return {
      items: live.slice(0, boundedLimit),
      releaseId,
      source,
      completeCatalogue: false,
      warning,
    };
  } catch (error) {
    if (!(error instanceof Icd11Error)) throw error;
    warning =
      error.code === 'WHO_NOT_CONFIGURED'
        ? 'WHO API credentials are not configured. Only previously cached WHO results are available.'
        : 'WHO API is unavailable. Only previously cached WHO results are available.';
  }
  // Cache is partial; SQL parameters are bound and the result is bounded.
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const rows = await db
    .select()
    .from(schema.icd11CatalogueEntries)
    .where(
      and(
        eq(schema.icd11CatalogueEntries.releaseId, releaseId),
        eq(schema.icd11CatalogueEntries.cachedFromWhoApi, true),
        eq(schema.icd11CatalogueEntries.isActive, true),
        or(
          ilike(schema.icd11CatalogueEntries.code, like),
          ilike(schema.icd11CatalogueEntries.title, like),
          sql`${schema.icd11CatalogueEntries.keywords}::text ILIKE ${like}`,
        ),
      ),
    )
    .limit(boundedLimit);
  return { items: rows, releaseId, source, completeCatalogue: false, warning };
}

export async function getIcd11EntryByCode(code: string, releaseId: string) {
  if (!isPlausibleIcd11Code(code) || !/^\d{4}-\d{2}$/.test(releaseId)) return null;
  const [entry] = await db
    .select()
    .from(schema.icd11CatalogueEntries)
    .where(
      and(
        eq(schema.icd11CatalogueEntries.code, code.trim().toUpperCase()),
        eq(schema.icd11CatalogueEntries.releaseId, releaseId),
        eq(schema.icd11CatalogueEntries.cachedFromWhoApi, true),
        eq(schema.icd11CatalogueEntries.isActive, true),
      ),
    )
    .limit(1);
  return entry ?? null;
}

export async function normalizeNewDiagnosisCoding(input: {
  codingSystem?: string;
  icd11Code?: string | null;
  icd11Release?: string | null;
  icd10Code?: string | null;
  icd10Description?: string | null;
}) {
  const system = input.codingSystem?.trim().toUpperCase() || 'ICD-10';
  if (system === 'ICD-10') {
    const code = input.icd10Code?.trim().toUpperCase() ?? '';
    const display = input.icd10Description?.trim() ?? '';
    if (!code || !display || code.length > 80 || display.length > 500) {
      throw new Icd11Error(
        'INVALID_DIAGNOSIS',
        'ICD-10 code and diagnosis description are required.',
      );
    }
    return {
      codingSystem: 'ICD-10',
      diagnosisCode: code,
      diagnosisDisplay: display,
      icd10Code: code,
      icd10Description: display,
      icd11Code: null,
      icd11Title: null,
      icd11Release: null,
      icd11FoundationUri: null,
      icd11LinearizationUri: null,
      codingMetadata: { originalCodingSystem: 'ICD-10', autoRecoded: false },
    };
  }
  if (system !== 'ICD-11') {
    throw new Icd11Error('UNSUPPORTED_CODING_SYSTEM', 'Coding system must be ICD-10 or ICD-11.');
  }
  const code = input.icd11Code?.trim().toUpperCase() ?? '';
  const release = input.icd11Release?.trim() ?? '';
  const entry = await getIcd11EntryByCode(code, release);
  if (!entry) {
    throw new Icd11Error(
      'ICD11_CODE_NOT_VERIFIED',
      'Select an active ICD-11 code from the WHO API search results for the specified release.',
    );
  }
  const legacyCode = input.icd10Code?.trim().toUpperCase() || null;
  const legacyDisplay = input.icd10Description?.trim() || null;
  if (Boolean(legacyCode) !== Boolean(legacyDisplay)) {
    throw new Icd11Error(
      'INVALID_DUAL_CODING',
      'Provide both the ICD-10 code and description, or neither.',
    );
  }
  return {
    codingSystem: 'ICD-11',
    diagnosisCode: entry.code,
    diagnosisDisplay: entry.title,
    icd10Code: legacyCode,
    icd10Description: legacyDisplay,
    icd11Code: entry.code,
    icd11Title: entry.title,
    icd11Release: entry.releaseId,
    icd11FoundationUri: entry.foundationUri,
    icd11LinearizationUri: entry.linearizationUri,
    codingMetadata: {
      originalCodingSystem: 'ICD-11',
      source: entry.sourceName,
      sourceUrl: entry.sourceUrl,
      fetchedAt: entry.fetchedAt?.toISOString() ?? null,
      autoRecoded: false,
    },
  };
}

/** Never infer a coding system from the first character of a historical code. */
export function presentPersistedDiagnosis(row: {
  codingSystem?: string | null;
  diagnosisCode?: string | null;
  diagnosisDisplay?: string | null;
  icd10Code: string | null;
  icd10Description: string | null;
  icd11Code?: string | null;
  icd11Title?: string | null;
  icd11Release?: string | null;
}) {
  const system = row.codingSystem === 'ICD-11' ? 'ICD-11' : 'ICD-10';
  return {
    codingSystem: system,
    primaryCode: system === 'ICD-11' ? row.icd11Code : row.icd10Code,
    primaryDisplay: system === 'ICD-11' ? row.icd11Title : row.icd10Description,
    releaseId: system === 'ICD-11' ? (row.icd11Release ?? null) : null,
    legacyIcd10: row.icd10Code ? { code: row.icd10Code, description: row.icd10Description } : null,
  };
}

/** Explicit payer policy is mandatory; no conversion or payer acceptance is assumed. */
export function validateExternalDiagnosisCoding(input: {
  codingSystem: string;
  code: string;
  allowedCodingSystems?: string[] | null;
}) {
  const system = input.codingSystem.toUpperCase();
  if (system !== 'ICD-10' && system !== 'ICD-11') {
    return {
      valid: false,
      code: 'UNSUPPORTED_CODING_SYSTEM',
      message: 'Only explicitly supported ICD coding systems may be submitted.',
    };
  }
  if (!input.allowedCodingSystems?.length) {
    return {
      valid: false,
      code: 'PAYER_CODING_POLICY_UNVERIFIED',
      message: 'Configure the payer-approved coding systems before submission.',
    };
  }
  if (!input.allowedCodingSystems.map((s) => s.toUpperCase()).includes(system)) {
    return {
      valid: false,
      code: 'UNSUPPORTED_CODING_SYSTEM',
      message: 'This coding system is not allowed by the configured payer policy.',
    };
  }
  if (!input.code || input.code === 'UNCODED') {
    return {
      valid: false,
      code: 'DIAGNOSIS_CODE_REQUIRED',
      message: 'A coded diagnosis is required before submission.',
    };
  }
  return {
    valid: true,
    code: input.code,
    systemUri:
      system === 'ICD-11' ? WHO_ICD11_SYSTEM_URI : system === 'ICD-10' ? ICD10_SYSTEM_URI : null,
    message:
      'The code matches the configured coding-system policy; external acceptance is not guaranteed.',
  };
}
