/**
 * JaliCare HMIS
 * DHA / AfyaConnect — errors
 *
 * Errors are designed to be safe to persist and to show an administrator.
 * They carry the operation, the HTTP status and DHA's own error code, but
 * never a request body, a token, or patient data.
 */

export type DhaErrorCode =
  | 'NOT_CONFIGURED'
  | 'PRODUCTION_BLOCKED'
  | 'AUTH_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

export class DhaError extends Error {
  readonly code: DhaErrorCode;
  /** Logical operation, e.g. "eligibility.check". Never a URL with ids. */
  readonly operation: string;
  /** HTTP status when a response was received. */
  readonly status: number | null;
  /** Non-retryable failures should not be attempted again by callers. */
  readonly retryable: boolean;
  /** DHA's own machine-readable code, when the response carried one. */
  readonly providerCode: string | null;

  constructor(
    code: DhaErrorCode,
    operation: string,
    message: string,
    options: {
      status?: number | null;
      retryable?: boolean;
      providerCode?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'DhaError';
    this.code = code;
    this.operation = operation;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.providerCode = options.providerCode ?? null;
  }
}

export function statusToCode(status: number): DhaErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 422) return 'VALIDATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  if (status >= 400) return 'VALIDATION_FAILED';

  return 'INVALID_RESPONSE';
}

/**
 * Pull a short, safe message out of a DHA error body.
 *
 * Error bodies are not echoed wholesale: a 422 can quote the submitted
 * fields, which for a claim includes patient data. Only a short message
 * or error code survives, and it is truncated.
 */
export function safeProviderMessage(body: unknown): {
  message: string | null;
  code: string | null;
} {
  if (typeof body !== 'object' || body === null) {
    return { message: null, code: null };
  }

  const record = body as Record<string, unknown>;

  const candidates = ['message', 'error_description', 'detail', 'error'];

  for (const key of candidates) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return {
        message: value.trim().slice(0, 200),
        code: key === 'error' ? value.slice(0, 64) : null,
      };
    }
  }

  return { message: null, code: null };
}
