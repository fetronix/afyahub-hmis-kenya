import type { LoginInput } from "./auth.types";

/*
|--------------------------------------------------------------------------
| Validation Constants
|--------------------------------------------------------------------------
*/

const MAX_IDENTIFIER_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_IP_ADDRESS_LENGTH = 64;

/*
|--------------------------------------------------------------------------
| Validation Error
|--------------------------------------------------------------------------
*/

export class AuthValidationError extends Error {
  public readonly code: string;

  constructor(
    message: string,
    code = "VALIDATION_ERROR"
  ) {
    super(message);

    this.name = "AuthValidationError";
    this.code = code;
  }
}

/*
|--------------------------------------------------------------------------
| Generic String Validation
|--------------------------------------------------------------------------
*/

function isNonEmptyString(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

/*
|--------------------------------------------------------------------------
| Identifier Validation
|--------------------------------------------------------------------------
|
| The identifier may be:
| - username
| - email address
|
| We deliberately do not perform database lookups here.
|
*/

export function validateIdentifier(
  identifier: unknown
): string {
  if (!isNonEmptyString(identifier)) {
    throw new AuthValidationError(
      "Username or email is required.",
      "INVALID_IDENTIFIER"
    );
  }

  const normalized =
    identifier.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new AuthValidationError(
      "Username or email is invalid.",
      "INVALID_IDENTIFIER"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Control-character protection
  |--------------------------------------------------------------------------
  |
  | Reject characters such as newline, carriage return,
  | tab and other ASCII control characters.
  |
  */

  if (/[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new AuthValidationError(
      "Username or email contains invalid characters.",
      "INVALID_IDENTIFIER"
    );
  }

  return normalized;
}

/*
|--------------------------------------------------------------------------
| Password Validation
|--------------------------------------------------------------------------
*/

export function validatePassword(
  password: unknown
): string {
  if (
    typeof password !== "string"
  ) {
    throw new AuthValidationError(
      "Password is required.",
      "INVALID_PASSWORD"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Do NOT trim passwords.
  |--------------------------------------------------------------------------
  |
  | Spaces can legitimately be part of a password.
  |
  */

  if (
    password.length < MIN_PASSWORD_LENGTH
  ) {
    throw new AuthValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
      "INVALID_PASSWORD"
    );
  }

  if (
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new AuthValidationError(
      `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`,
      "INVALID_PASSWORD"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Reject NUL bytes
  |--------------------------------------------------------------------------
  */

  if (password.includes("\u0000")) {
    throw new AuthValidationError(
      "Password contains invalid characters.",
      "INVALID_PASSWORD"
    );
  }

  return password;
}

/*
|--------------------------------------------------------------------------
| IP Address Validation
|--------------------------------------------------------------------------
|
| This is intentionally basic.
|
| The HTTP layer should determine the trusted client IP.
| Do not blindly trust arbitrary X-Forwarded-For headers.
|
*/

export function validateIpAddress(
  ipAddress: unknown
): string | null {
  if (
    ipAddress === undefined ||
    ipAddress === null ||
    ipAddress === ""
  ) {
    return null;
  }

  if (
    typeof ipAddress !== "string"
  ) {
    throw new AuthValidationError(
      "Invalid IP address.",
      "INVALID_IP_ADDRESS"
    );
  }

  const normalized =
    ipAddress.trim();

  if (
    normalized.length === 0
  ) {
    return null;
  }

  if (
    normalized.length > MAX_IP_ADDRESS_LENGTH
  ) {
    throw new AuthValidationError(
      "Invalid IP address.",
      "INVALID_IP_ADDRESS"
    );
  }

  if (
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new AuthValidationError(
      "Invalid IP address.",
      "INVALID_IP_ADDRESS"
    );
  }

  return normalized;
}

/*
|--------------------------------------------------------------------------
| User-Agent Validation
|--------------------------------------------------------------------------
*/

export function validateUserAgent(
  userAgent: unknown
): string | null {
  if (
    userAgent === undefined ||
    userAgent === null ||
    userAgent === ""
  ) {
    return null;
  }

  if (
    typeof userAgent !== "string"
  ) {
    throw new AuthValidationError(
      "Invalid user agent.",
      "INVALID_USER_AGENT"
    );
  }

  const normalized =
    userAgent.trim();

  if (
    normalized.length === 0
  ) {
    return null;
  }

  if (
    normalized.length > MAX_USER_AGENT_LENGTH
  ) {
    throw new AuthValidationError(
      "User agent is too long.",
      "INVALID_USER_AGENT"
    );
  }

  if (
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new AuthValidationError(
      "User agent contains invalid characters.",
      "INVALID_USER_AGENT"
    );
  }

  return normalized;
}

/*
|--------------------------------------------------------------------------
| Login Request Validation
|--------------------------------------------------------------------------
*/

export function validateLoginInput(
  input: unknown
): LoginInput {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new AuthValidationError(
      "Invalid login request.",
      "INVALID_REQUEST"
    );
  }

  const request =
    input as Record<string, unknown>;

  const identifier =
    validateIdentifier(
      request.identifier
    );

  const password =
    validatePassword(
      request.password
    );

  const ipAddress =
    validateIpAddress(
      request.ipAddress
    );

  const userAgent =
    validateUserAgent(
      request.userAgent
    );

  return {
    identifier,
    password,
    ipAddress,
    userAgent,
  };
}

/*
|--------------------------------------------------------------------------
| Session Token Validation
|--------------------------------------------------------------------------
*/

export function validateSessionToken(
  sessionToken: unknown
): string {
  if (
    typeof sessionToken !== "string"
  ) {
    throw new AuthValidationError(
      "Session token is required.",
      "INVALID_SESSION_TOKEN"
    );
  }

  const token =
    sessionToken.trim();

  if (
    token.length === 0
  ) {
    throw new AuthValidationError(
      "Session token is required.",
      "INVALID_SESSION_TOKEN"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Session tokens generated by session.service.ts use
  | crypto.randomBytes(48).toString("base64url").
  |
  | Base64url characters:
  | A-Z a-z 0-9 - _
  |--------------------------------------------------------------------------
  */

  if (
    !/^[A-Za-z0-9_-]{64}$/.test(token)
  ) {
    throw new AuthValidationError(
      "Invalid session token.",
      "INVALID_SESSION_TOKEN"
    );
  }

  return token;
}

/*
|--------------------------------------------------------------------------
| Password Reset Email Validation
|--------------------------------------------------------------------------
*/

export function validateEmail(
  email: unknown
): string {
  if (!isNonEmptyString(email)) {
    throw new AuthValidationError(
      "Email address is required.",
      "INVALID_EMAIL"
    );
  }

  const normalized =
    email.trim().toLowerCase();

  if (
    normalized.length > 254
  ) {
    throw new AuthValidationError(
      "Email address is too long.",
      "INVALID_EMAIL"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Practical email validation.
  |--------------------------------------------------------------------------
  |
  | This is not intended to implement the entire RFC.
  | Final account existence checks belong to the service layer.
  |
  */

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    !emailPattern.test(normalized)
  ) {
    throw new AuthValidationError(
      "Invalid email address.",
      "INVALID_EMAIL"
    );
  }

  if (
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new AuthValidationError(
      "Email address contains invalid characters.",
      "INVALID_EMAIL"
    );
  }

  return normalized;
}

/*
|--------------------------------------------------------------------------
| Password Reset Token Validation
|--------------------------------------------------------------------------
*/

export function validatePasswordResetToken(
  token: unknown
): string {
  if (
    typeof token !== "string"
  ) {
    throw new AuthValidationError(
      "Password reset token is required.",
      "INVALID_RESET_TOKEN"
    );
  }

  const normalized =
    token.trim();

  if (
    normalized.length < 32 ||
    normalized.length > 512
  ) {
    throw new AuthValidationError(
      "Invalid password reset token.",
      "INVALID_RESET_TOKEN"
    );
  }

  if (
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new AuthValidationError(
      "Invalid password reset token.",
      "INVALID_RESET_TOKEN"
    );
  }

  return normalized;
}

/*
|--------------------------------------------------------------------------
| New Password Validation
|--------------------------------------------------------------------------
*/

export function validateNewPassword(
  password: unknown
): string {
  return validatePassword(password);
}