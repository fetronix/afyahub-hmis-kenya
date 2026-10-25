/**
 * Authentication input validation
 *
 * `src/auth/auth.validation.ts` is the gate every login, session check and
 * password reset passes through. It imports nothing but a type, so these
 * tests exercise the real functions rather than a mock — no database, no
 * HTTP, no environment.
 *
 * The module exists to guarantee three things, and each is tested here:
 *
 *   1. Malformed input is rejected *before* it reaches the service layer,
 *      with a typed error carrying a stable code, so an endpoint can answer
 *      400 without leaking an internals message.
 *   2. Normalisation is predictable — identifiers and emails are trimmed and
 *      lower-cased, passwords never are (a leading space is a character a
 *      user chose, not noise).
 *   3. Control characters do not get through, because a newline in a
 *      username or header is how log injection and header splitting start.
 *
 * Boundary values are tested on both sides (11/12 characters, 128/129, and
 * so on), because an off-by-one in a password length rule is both a security
 * bug and a usability bug.
 *
 * Every string below is synthetic.
 */

import { describe, expect, it } from 'vitest';

import {
  AuthValidationError,
  validateEmail,
  validateIdentifier,
  validateIpAddress,
  validateLoginInput,
  validateNewPassword,
  validatePassword,
  validatePasswordResetToken,
  validateSessionToken,
  validateUserAgent,
} from '../../auth/auth.validation.ts';

/** The error must carry a code an endpoint can branch on. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthValidationError);
    expect((error as AuthValidationError).code).toBe(code);
    return;
  }

  throw new Error(`expected AuthValidationError(${code}), nothing was thrown`);
}

describe('AuthValidationError', () => {
  it('is an Error with a name and a code', () => {
    const error = new AuthValidationError('bad input', 'INVALID_THING');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthValidationError');
    expect(error.code).toBe('INVALID_THING');
    expect(error.message).toBe('bad input');
  });

  it('defaults the code rather than leaving it undefined', () => {
    expect(new AuthValidationError('bad input').code).toBe('VALIDATION_ERROR');
  });
});

describe('validateIdentifier', () => {
  it('trims and lower-cases, so lookups are case-insensitive', () => {
    expect(validateIdentifier('  Dr.Otieno  ')).toBe('dr.otieno');
    expect(validateIdentifier('ADMIN')).toBe('admin');
  });

  it('accepts an email address as the identifier', () => {
    expect(validateIdentifier('Admin@Facility.co.ke')).toBe('admin@facility.co.ke');
  });

  it('rejects an empty or whitespace-only identifier', () => {
    expectCode(() => validateIdentifier(''), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier('   '), 'INVALID_IDENTIFIER');
  });

  it('rejects non-string input', () => {
    expectCode(() => validateIdentifier(undefined), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier(null), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier(42), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier({}), 'INVALID_IDENTIFIER');
  });

  it('accepts 254 characters and rejects 255', () => {
    expect(validateIdentifier('a'.repeat(254))).toHaveLength(254);
    expectCode(() => validateIdentifier('a'.repeat(255)), 'INVALID_IDENTIFIER');
  });

  it('rejects embedded control characters, which is how log injection starts', () => {
    expectCode(() => validateIdentifier('adm\u0000in'), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier('adm\nin'), 'INVALID_IDENTIFIER');
    expectCode(() => validateIdentifier('admin\u007F'), 'INVALID_IDENTIFIER');
  });

  it('trims edge whitespace before the control-character check', () => {
    // Normalisation happens first, so a trailing newline is removed rather
    // than rejected. That is safe for the property being protected: a
    // stripped trailing newline cannot split a log line. Only characters
    // that survive the trim reach the check.
    expect(validateIdentifier('admin\n')).toBe('admin');
    expect(validateIdentifier('\tadmin\t')).toBe('admin');
  });
});

describe('validatePassword', () => {
  it('accepts twelve characters and rejects eleven', () => {
    expect(validatePassword('a'.repeat(12))).toBe('a'.repeat(12));
    expectCode(() => validatePassword('a'.repeat(11)), 'INVALID_PASSWORD');
  });

  it('accepts 128 characters and rejects 129', () => {
    expect(validatePassword('a'.repeat(128))).toHaveLength(128);
    expectCode(() => validatePassword('a'.repeat(129)), 'INVALID_PASSWORD');
  });

  it('does not trim: spaces are part of the password', () => {
    const password = '  correct horse  ';

    expect(validatePassword(password)).toBe(password);
  });

  it('counts a passphrase with spaces by its real length', () => {
    expect(validatePassword('correct horse')).toBe('correct horse');
  });

  it('rejects non-string input', () => {
    expectCode(() => validatePassword(undefined), 'INVALID_PASSWORD');
    expectCode(() => validatePassword(null), 'INVALID_PASSWORD');
    expectCode(() => validatePassword(12345678901234), 'INVALID_PASSWORD');
  });

  it('rejects an embedded NUL byte', () => {
    expectCode(() => validatePassword('abcdefghijkl\u0000'), 'INVALID_PASSWORD');
  });

  it('allows other control-free punctuation and unicode', () => {
    expect(validatePassword('pässwörd-2026!')).toBe('pässwörd-2026!');
  });
});

describe('validateIpAddress', () => {
  it('treats absent values as null rather than an error', () => {
    expect(validateIpAddress(undefined)).toBeNull();
    expect(validateIpAddress(null)).toBeNull();
    expect(validateIpAddress('')).toBeNull();
    expect(validateIpAddress('   ')).toBeNull();
  });

  it('returns the trimmed address', () => {
    expect(validateIpAddress('  197.248.1.10  ')).toBe('197.248.1.10');
    expect(validateIpAddress('::1')).toBe('::1');
  });

  it('accepts 64 characters and rejects 65', () => {
    expect(validateIpAddress('1'.repeat(64))).toHaveLength(64);
    expectCode(() => validateIpAddress('1'.repeat(65)), 'INVALID_IP_ADDRESS');
  });

  it('rejects non-string input', () => {
    expectCode(() => validateIpAddress(1234), 'INVALID_IP_ADDRESS');
    expectCode(() => validateIpAddress({}), 'INVALID_IP_ADDRESS');
  });

  it('rejects embedded control characters, and trims edge ones', () => {
    expectCode(() => validateIpAddress('1.2\u0000.3.4'), 'INVALID_IP_ADDRESS');
    expect(validateIpAddress('1.2.3.4\n')).toBe('1.2.3.4');
  });
});

describe('validateUserAgent', () => {
  it('treats absent values as null', () => {
    expect(validateUserAgent(undefined)).toBeNull();
    expect(validateUserAgent(null)).toBeNull();
    expect(validateUserAgent('  ')).toBeNull();
  });

  it('returns a trimmed agent string', () => {
    expect(validateUserAgent('  Mozilla/5.0  ')).toBe('Mozilla/5.0');
  });

  it('accepts 1000 characters and rejects 1001', () => {
    expect(validateUserAgent('x'.repeat(1000))).toHaveLength(1000);
    expectCode(() => validateUserAgent('x'.repeat(1001)), 'INVALID_USER_AGENT');
  });

  it('rejects embedded control characters, and trims edge ones', () => {
    expectCode(() => validateUserAgent('cu\u0000rl'), 'INVALID_USER_AGENT');
    expect(validateUserAgent('curl\r\n')).toBe('curl');
  });

  it('rejects non-string input', () => {
    expectCode(() => validateUserAgent(99), 'INVALID_USER_AGENT');
  });
});

describe('validateLoginInput', () => {
  const valid = {
    identifier: '  Admin  ',
    password: 'correct horse battery',
    ipAddress: ' 10.0.0.5 ',
    userAgent: ' Mozilla/5.0 ',
  };

  it('returns a normalised login request', () => {
    expect(validateLoginInput(valid)).toEqual({
      identifier: 'admin',
      password: 'correct horse battery',
      ipAddress: '10.0.0.5',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('rejects a body that is not an object', () => {
    for (const input of [null, undefined, 'admin', 42, ['admin']]) {
      expectCode(() => validateLoginInput(input), 'INVALID_REQUEST');
    }
  });

  it('rejects an array, which is an object but cannot be a login body', () => {
    expectCode(() => validateLoginInput([]), 'INVALID_REQUEST');
  });

  it('propagates the field-level error, not a generic one', () => {
    expectCode(() => validateLoginInput({ ...valid, identifier: '' }), 'INVALID_IDENTIFIER');
    expectCode(() => validateLoginInput({ ...valid, password: 'short' }), 'INVALID_PASSWORD');
  });

  it('leaves optional fields null when omitted', () => {
    const result = validateLoginInput({
      identifier: 'admin',
      password: 'correct horse battery',
    });

    expect(result.ipAddress).toBeNull();
    expect(result.userAgent).toBeNull();
  });
});

describe('validateSessionToken', () => {
  const token = 'a'.repeat(64);

  it('accepts a 64-character base64url token', () => {
    expect(validateSessionToken(token)).toBe(token);
    expect(validateSessionToken('Ab-9_x'.repeat(1) + 'a'.repeat(58))).toHaveLength(64);
  });

  it('trims surrounding whitespace before checking the shape', () => {
    expect(validateSessionToken(`  ${token}  `)).toBe(token);
  });

  it('rejects the wrong length on both sides', () => {
    expectCode(() => validateSessionToken('a'.repeat(63)), 'INVALID_SESSION_TOKEN');
    expectCode(() => validateSessionToken('a'.repeat(65)), 'INVALID_SESSION_TOKEN');
  });

  it('rejects characters outside the base64url alphabet', () => {
    expectCode(() => validateSessionToken(`${'a'.repeat(63)}+`), 'INVALID_SESSION_TOKEN');
    expectCode(() => validateSessionToken(`${'a'.repeat(63)}/`), 'INVALID_SESSION_TOKEN');
    expectCode(() => validateSessionToken(`${'a'.repeat(63)} `), 'INVALID_SESSION_TOKEN');
  });

  it('rejects empty and non-string input', () => {
    expectCode(() => validateSessionToken(''), 'INVALID_SESSION_TOKEN');
    expectCode(() => validateSessionToken('   '), 'INVALID_SESSION_TOKEN');
    expectCode(() => validateSessionToken(null), 'INVALID_SESSION_TOKEN');
  });
});

describe('validateEmail', () => {
  it('trims and lower-cases', () => {
    expect(validateEmail('  Admin@Facility.CO.KE ')).toBe('admin@facility.co.ke');
  });

  it('rejects addresses without a dot in the domain', () => {
    expectCode(() => validateEmail('admin@localhost'), 'INVALID_EMAIL');
  });

  it('rejects addresses with spaces or a second @', () => {
    expectCode(() => validateEmail('ad min@facility.co.ke'), 'INVALID_EMAIL');
    expectCode(() => validateEmail('a@b@facility.co.ke'), 'INVALID_EMAIL');
  });

  it('rejects empty and non-string input', () => {
    expectCode(() => validateEmail(''), 'INVALID_EMAIL');
    expectCode(() => validateEmail(null), 'INVALID_EMAIL');
  });

  it('rejects embedded control characters, and trims edge ones', () => {
    expectCode(() => validateEmail('ad\u0000min@x.co.ke'), 'INVALID_EMAIL');
    expect(validateEmail('admin@x.co.ke\n')).toBe('admin@x.co.ke');
  });
});

describe('validatePasswordResetToken', () => {
  it('accepts 32 to 512 characters', () => {
    expect(validatePasswordResetToken('a'.repeat(32))).toHaveLength(32);
    expect(validatePasswordResetToken('a'.repeat(512))).toHaveLength(512);
  });

  it('rejects 31 and 513', () => {
    expectCode(() => validatePasswordResetToken('a'.repeat(31)), 'INVALID_RESET_TOKEN');
    expectCode(() => validatePasswordResetToken('a'.repeat(513)), 'INVALID_RESET_TOKEN');
  });

  it('rejects non-string input and control characters', () => {
    expectCode(() => validatePasswordResetToken(undefined), 'INVALID_RESET_TOKEN');
    expectCode(() => validatePasswordResetToken(`${'a'.repeat(31)}\n`), 'INVALID_RESET_TOKEN');
  });
});

describe('validateNewPassword', () => {
  it('applies the same rules as the login password', () => {
    expect(validateNewPassword('a'.repeat(12))).toHaveLength(12);
    expectCode(() => validateNewPassword('a'.repeat(11)), 'INVALID_PASSWORD');
    expectCode(() => validateNewPassword('a'.repeat(129)), 'INVALID_PASSWORD');
  });

  it('does not trim, so a chosen leading space survives', () => {
    expect(validateNewPassword('  spaced password  ')).toBe('  spaced password  ');
  });
});
