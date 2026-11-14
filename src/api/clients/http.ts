export const API_BASE = '/api';

/**
 * Session storage
 *
 * The raw session token is stored on the client so it can be
 * sent as a Bearer token with authenticated API requests.
 *
 * The server stores only the SHA-256 hash of this token.
 */
const SESSION_TOKEN_KEY = 'jalicare_session_token';
let memorySessionToken: string | null = null;

function hasBrowserStorage(): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    localStorage !== null &&
    typeof localStorage.getItem === 'function' &&
    typeof localStorage.setItem === 'function' &&
    typeof localStorage.removeItem === 'function'
  );
}

/**
 * Get the current authentication session token.
 */
export function getSessionToken(): string | null {
  if (hasBrowserStorage()) {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  }
  return memorySessionToken;
}

/**
 * Store the authentication session token.
 */
export function setSessionToken(token: string): void {
  if (!token) {
    throw new Error('Cannot store an empty session token.');
  }

  if (hasBrowserStorage()) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    return;
  }
  memorySessionToken = token;
}

/**
 * Remove the authentication session token.
 */
export function clearSessionToken(): void {
  if (hasBrowserStorage()) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
  memorySessionToken = null;
}

/**
 * Check whether a session token exists locally.
 *
 * This does NOT prove that the session is valid.
 * The server must validate the token.
 */
export function hasSessionToken(): boolean {
  return Boolean(getSessionToken());
}

/**
 * Common API error structure.
 */
export interface ApiErrorResponse {
  success?: boolean;
  error?: string;
  message?: string;
  detail?: Record<string, unknown>;
}

/**
 * What the billing engine answered for a clinical action.
 *
 * `charged: false` with `reason: 'TARIFF_NOT_CONFIGURED'` is a normal
 * outcome, not an error: the service happened and the facility has no
 * price for it yet. The screen must say that rather than show zero.
 */
export interface ServiceCharge {
  charged: boolean;
  reason?: string;
  invoiceId?: number;
  invoiceNumber?: string;
  itemId?: number;
  tariffCode?: string;
  description?: string;
  quantity?: number;
  /** The tariff's own unit: "Per visit", "Per day", "Test". */
  unit?: string | null;
  unitPrice?: string;
  totalAmount?: string;
  /** How the price was found, when one was. */
  matchRule?: 'LINK' | 'CODE' | 'CATALOGUE';
  matchExplanation?: string;
  codesTried?: string[];
  message?: string;
}

/**
 * Error thrown for a non-2xx response.
 *
 * `code` carries the server's machine-readable error code (for example
 * PAYMENT_EXCEEDS_BALANCE) so callers can branch without parsing prose.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly detail?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type UnauthorizedSessionListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedSessionListener>();

/**
 * Subscribe to mid-session 401 responses from authenticated API calls so the
 * auth provider can clear UI state through the existing authentication flow.
 */
export function onUnauthorizedSession(listener: UnauthorizedSessionListener): () => void {
  unauthorizedListeners.add(listener);

  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorizedSession(): void {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {
      /* Listener errors must never mask the API error being thrown. */
    }
  }
}

function safeRequestPath(url: string): string {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? '/api';

  try {
    if (/^https?:\/\//i.test(withoutQuery)) {
      return new URL(withoutQuery).pathname || '/api';
    }
  } catch {
    return '/api';
  }

  return withoutQuery || '/api';
}

export function isHtmlPayload(contentType: string, body: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml') ||
    /^\s*<(?:!doctype\s+html|html\b)/i.test(body)
  );
}

function isJsonContentType(contentType: string): boolean {
  return contentType.includes('application/json') || contentType.includes('+json');
}

/**
 * Preserve meaningful backend messages while refusing to surface stack traces,
 * server file paths, database connection strings, or bearer tokens.
 */
export function sanitizeServerErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') {
    return fallback;
  }

  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > 400) {
    return fallback;
  }

  const hasUnsafeDetail =
    /\n\s*at\s+\S+/.test(trimmed) ||
    /\bat\s+[^\s()]+\s*\([^)]*:\d+:\d+\)/.test(trimmed) ||
    /(?:\/home\/|\/app\/|\/Users\/|node_modules\/|src\/|[A-Za-z]:\\)[^\s'"]*\.(?:ts|tsx|js|mjs|cjs)/i.test(
      trimmed,
    ) ||
    /\bpostgres(?:ql)?:\/\//i.test(trimmed) ||
    /\bpassword\s*=/i.test(trimmed) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(trimmed);

  if (hasUnsafeDetail) {
    return fallback;
  }

  return trimmed;
}

/**
 * Generic authenticated API request helper.
 *
 * Every request automatically receives:
 *
 * Authorization: Bearer <session-token>
 *
 * when a session token exists.
 */
export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const sessionToken = getSessionToken();
  const requestPath = safeRequestPath(url);

  const headers = new Headers(options?.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  let res: Response;

  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    throw new ApiError(
      'Unable to reach the JaliCare HMIS server. Check your connection or try again shortly.',
      503,
      'SERVICE_UNAVAILABLE',
    );
  }

  const contentType = (res.headers?.get?.('content-type') ?? '').toLowerCase();

  if (!res.ok) {
    if (res.status === 401 && !requestPath.endsWith('/auth/login')) {
      clearSessionToken();
      notifyUnauthorizedSession();
    }

    const rawErrorBody = typeof res.text === 'function' ? await res.text().catch(() => '') : '';

    if (
      rawErrorBody.trim() !== '' &&
      (isJsonContentType(contentType) ||
        (!contentType && !isHtmlPayload(contentType, rawErrorBody)))
    ) {
      try {
        const parsed = JSON.parse(rawErrorBody) as ApiErrorResponse;

        if (parsed && typeof parsed === 'object') {
          const fallback =
            res.status >= 500 ? 'An unexpected server error occurred.' : `HTTP error ${res.status}`;
          const message = sanitizeServerErrorMessage(parsed.message ?? parsed.error, fallback);
          const code = typeof parsed.error === 'string' ? parsed.error : undefined;
          const detail =
            parsed.detail && typeof parsed.detail === 'object' ? parsed.detail : undefined;

          throw new ApiError(message, res.status, code, detail);
        }
      } catch (parseErr) {
        if (parseErr instanceof ApiError) {
          throw parseErr;
        }
      }
    }

    if (isHtmlPayload(contentType, rawErrorBody)) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new ApiError(
          'The JaliCare HMIS service is temporarily unavailable. Please try again shortly.',
          res.status,
          'SERVICE_UNAVAILABLE',
        );
      }

      if (res.status === 401) {
        throw new ApiError(
          'Authentication is required. Please sign in again.',
          401,
          'UNAUTHORIZED',
        );
      }

      if (res.status === 403) {
        throw new ApiError('You do not have permission to access this resource.', 403, 'FORBIDDEN');
      }

      if (res.status === 404) {
        throw new ApiError(
          `API endpoint not found (${requestPath}). Received an HTML page instead of JSON.`,
          404,
          'UNEXPECTED_HTML_RESPONSE',
        );
      }

      throw new ApiError(
        `Expected JSON from ${requestPath}, but received an HTML error page (HTTP ${res.status}).`,
        res.status,
        'UNEXPECTED_HTML_RESPONSE',
      );
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new ApiError(
        'The JaliCare HMIS service is temporarily unavailable. Please try again shortly.',
        res.status,
        'SERVICE_UNAVAILABLE',
      );
    }

    const fallbackStatus = sanitizeServerErrorMessage(res.statusText, `HTTP error ${res.status}`);

    throw new ApiError(
      fallbackStatus === `HTTP error ${res.status}`
        ? fallbackStatus
        : `HTTP ${res.status}: ${fallbackStatus}`,
      res.status,
      'HTTP_ERROR',
    );
  }

  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  const rawBody = typeof res.text === 'function' ? await res.text() : '';

  if (rawBody.trim() === '') {
    const method = (options?.method ?? 'GET').toUpperCase();

    if (!isJsonContentType(contentType) && method !== 'GET' && method !== 'HEAD') {
      return undefined as T;
    }

    throw new ApiError(
      `Expected JSON from ${requestPath}, but received an empty response.`,
      res.status,
      'EMPTY_RESPONSE',
    );
  }

  if (isHtmlPayload(contentType, rawBody)) {
    throw new ApiError(
      `Expected JSON from ${requestPath}, but received an HTML document (HTTP ${res.status}). Check API routing or proxy configuration.`,
      res.status,
      'UNEXPECTED_HTML_RESPONSE',
    );
  }

  if (contentType && !isJsonContentType(contentType)) {
    const mediaType = contentType.split(';')[0]?.trim() || contentType;

    throw new ApiError(
      `Expected JSON from ${requestPath}, but received content-type "${mediaType}".`,
      res.status,
      'UNEXPECTED_CONTENT_TYPE',
    );
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new ApiError(
      `Invalid JSON response received from ${requestPath}.`,
      res.status,
      'INVALID_JSON_RESPONSE',
    );
  }
}
