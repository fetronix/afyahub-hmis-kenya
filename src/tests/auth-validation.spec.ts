import {
  validateLoginInput,
  validateIdentifier,
  validatePassword,
  validateSessionToken,
  validateEmail,
  AuthValidationError,
} from '../auth/auth.validation';

import { describe, expect, it } from 'vitest';

describe('Auth-validation', () => {
  it('Validation', async () => {
    /*
    |--------------------------------------------------------------------------
    | TEST 1 — Valid Login
    |--------------------------------------------------------------------------
    */

    const login = validateLoginInput({
      identifier: 'admin',
      password: 'ValidTestPassword123!',
      ipAddress: '127.0.0.1',
      userAgent: 'JaliCare-Test',
    });

    expect(login.identifier === 'admin', 'Valid identifier accepted').toBe(true);

    expect(login.password === 'ValidTestPassword123!', 'Valid password accepted').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 2 — Identifier Normalization
    |--------------------------------------------------------------------------
    */

    const identifier = validateIdentifier('  ADMIN@JALICARE.CO.KE  ');

    expect(identifier === 'admin@jalicare.co.ke', 'Identifier is normalized').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 3 — Short Password
    |--------------------------------------------------------------------------
    */

    let rejected = false;

    try {
      validatePassword('short');
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Short password is rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 4 — Oversized Password
    |--------------------------------------------------------------------------
    */

    rejected = false;

    try {
      validatePassword('A'.repeat(129));
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Oversized password is rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 5 — Missing Identifier
    |--------------------------------------------------------------------------
    */

    rejected = false;

    try {
      validateIdentifier('');
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Missing identifier is rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 6 — Control Character
    |--------------------------------------------------------------------------
    */

    rejected = false;

    try {
      validateIdentifier('admin\nattack');
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Control characters are rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 7 — Invalid Session Token
    |--------------------------------------------------------------------------
    */

    rejected = false;

    try {
      validateSessionToken('invalid-session-token');
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Invalid session token is rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 8 — Valid Session Token
    |--------------------------------------------------------------------------
    */

    const validToken = 'A'.repeat(64);

    const validatedToken = validateSessionToken(validToken);

    expect(validatedToken === validToken, 'Valid session-token format is accepted').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 9 — Invalid Email
    |--------------------------------------------------------------------------
    */

    rejected = false;

    try {
      validateEmail('not-an-email');
    } catch (error) {
      rejected = error instanceof AuthValidationError;
    }

    expect(rejected, 'Invalid email is rejected').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | TEST 10 — Valid Email
    |--------------------------------------------------------------------------
    */

    const email = validateEmail('  ADMIN@JALICARE.CO.KE ');

    expect(email === 'admin@jalicare.co.ke', 'Email is normalized').toBe(true);

    /*
    |--------------------------------------------------------------------------
    | COMPLETE
    |--------------------------------------------------------------------------
    */
  });
});
