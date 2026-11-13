/**
 * JaliCare HMIS
 * Invitation Base URL Resolution
 *
 * Resolves the public origin/base URL used when issuing or reissuing
 * Facility Administrator and Staff invitation links:
 *
 *   1. Explicit `APP_BASE_URL` (preferred in production) — always takes
 *      precedence when configured, and fails closed if set to an invalid
 *      or insecure value.
 *   2. Verified request origin fallback — when `APP_BASE_URL` is left blank
 *      (for example in local development or initial cPanel/proxy setup),
 *      derives the base URL from the authenticated administrator's request
 *      while preventing `Origin` / `Host` header spoofing.
 */

import { resolveAllowedOrigins } from '../middleware/http-security.middleware.ts';

export interface InvitationRequestLike {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
}

export type ResolvedInvitationBaseUrl =
  | {
      ok: true;
      baseUrl: URL;
      source: 'env' | 'request';
    }
  | {
      ok: false;
      code: 'APP_BASE_URL_NOT_CONFIGURED' | 'INVALID_APP_BASE_URL';
      message: string;
    };

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function readHeader(req: InvitationRequestLike, name: string): string | null {
  const viaGetter = req.get?.(name);
  if (typeof viaGetter === 'string' && viaGetter.trim() !== '') {
    return viaGetter.trim();
  }
  const raw = req.headers?.[name.toLowerCase()] ?? req.headers?.[name];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim() !== '') {
    return raw[0].trim();
  }
  return null;
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function parseValidatedHost(rawHost: string | null): URL | null {
  if (!rawHost) return null;
  if (rawHost.length > 255) return null;
  // Reject whitespace, path separators, credentials, query/fragment, commas, or control chars
  if (/[\s/\\@?#,;]/.test(rawHost) || hasControlCharacters(rawHost)) {
    return null;
  }

  try {
    const parsed = new URL(`http://${rawHost}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    if (parsed.host.toLowerCase() !== rawHost.toLowerCase()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseHttpUrlWithoutCredentials(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolves the base URL for Facility Administrator and Staff invitation links.
 */
export function resolveInvitationBaseUrl(
  req: InvitationRequestLike,
  env: Record<string, string | undefined> = process.env,
): ResolvedInvitationBaseUrl {
  const isProduction = env.NODE_ENV === 'production';
  const explicit = env.APP_BASE_URL?.trim();

  // 1. Explicit APP_BASE_URL always wins when non-empty, and never falls back silently if malformed.
  if (explicit) {
    const parsed = parseHttpUrlWithoutCredentials(explicit);
    if (!parsed) {
      return {
        ok: false,
        code: 'INVALID_APP_BASE_URL',
        message: 'APP_BASE_URL must be a valid HTTP or HTTPS URL without embedded credentials.',
      };
    }

    if (isProduction && parsed.protocol !== 'https:' && !isLoopbackHostname(parsed.hostname)) {
      return {
        ok: false,
        code: 'INVALID_APP_BASE_URL',
        message:
          'APP_BASE_URL must use HTTPS in production (http://localhost or http://127.0.0.1 is allowed for local testing).',
      };
    }

    return {
      ok: true,
      baseUrl: parsed,
      source: 'env',
    };
  }

  // 2. Fallback when APP_BASE_URL is blank/unset: infer safely from verified request origin / host.
  const hostProbe = parseValidatedHost(readHeader(req, 'host'));
  const rawOrigin = readHeader(req, 'origin');
  const originUrl = rawOrigin ? parseHttpUrlWithoutCredentials(rawOrigin) : null;

  if (originUrl) {
    const allowedOrigins = resolveAllowedOrigins(env);
    const matchesRequestHost =
      hostProbe !== null && originUrl.host.toLowerCase() === hostProbe.host.toLowerCase();
    const isAllowlistedOrigin = allowedOrigins.includes(originUrl.origin);

    if (matchesRequestHost || isAllowlistedOrigin) {
      const protocolSafe =
        !isProduction || originUrl.protocol === 'https:' || isLoopbackHostname(originUrl.hostname);
      if (protocolSafe) {
        return {
          ok: true,
          baseUrl: new URL(originUrl.origin),
          source: 'request',
        };
      }
    }
  }

  if (hostProbe) {
    const forwardedProto = readHeader(req, 'x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      .toLowerCase();

    let protocol: 'http:' | 'https:';
    if (req.protocol === 'https' || forwardedProto === 'https') {
      protocol = 'https:';
    } else if (isProduction && !isLoopbackHostname(hostProbe.hostname)) {
      protocol = 'https:';
    } else {
      protocol = 'http:';
    }

    return {
      ok: true,
      baseUrl: new URL(`${protocol}//${hostProbe.host}`),
      source: 'request',
    };
  }

  return {
    ok: false,
    code: 'APP_BASE_URL_NOT_CONFIGURED',
    message:
      'APP_BASE_URL is not configured and could not be inferred from the request. Set APP_BASE_URL (for example https://hmis.example.co.ke or http://localhost:3000).',
  };
}

/**
 * Builds an invitation acceptance link preserving any deployment sub-path on `baseUrl`.
 */
export function buildInvitationUrl(
  baseUrl: URL,
  invitationPath: '/accept-facility-admin-invitation' | '/accept-staff-invitation',
  rawToken: string,
): string {
  const link = new URL(baseUrl.toString());
  const prefix = link.pathname.replace(/\/+$/, '');
  link.pathname = `${prefix}${invitationPath}`;
  link.search = '';
  link.hash = '';
  link.searchParams.set('token', rawToken);
  return link.toString();
}
