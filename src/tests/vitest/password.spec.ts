/**
 * Password hashing
 *
 * `src/utils/password.ts` is the only place a password becomes a hash and
 * the only place one is checked. Two properties matter to the facility and
 * to a regulator:
 *
 *   1. A stored hash must never reveal the password, so hashing must be
 *      salted — the same password hashed twice gives two different strings,
 *      and both verify.
 *   2. Verification must return `false` for a corrupt stored value rather
 *      than throwing. A single unreadable row in `users` must not take down
 *      the login endpoint for everyone.
 *
 * These tests exercise the real Argon2id implementation, not a stub, so
 * they cost real CPU. That is deliberate: a mocked KDF would prove nothing
 * about the thing that protects patient records.
 *
 * No password used below is real. They are throwaway strings that exist
 * only inside this file.
 */

import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../utils/password.ts';

const VALID = 'correct horse battery staple';

describe('hashPassword', () => {
  it('produces an Argon2id hash, not another algorithm', () => {
    // The prefix is what makes an old bcrypt row visibly different from a
    // current one during an incident review.
    return hashPassword(VALID).then((hash) => {
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });
  });

  it('never returns the password itself', async () => {
    const hash = await hashPassword(VALID);

    expect(hash).not.toContain(VALID);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hashPassword(VALID), hashPassword(VALID)]);

    expect(first).not.toBe(second);

    // Both must still verify: a random salt is not a random password.
    await expect(verifyPassword(VALID, first)).resolves.toBe(true);
    await expect(verifyPassword(VALID, second)).resolves.toBe(true);
  });

  it('rejects a password shorter than twelve characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 12 characters/i);

    // Eleven is the boundary on the rejecting side.
    await expect(hashPassword('a'.repeat(11))).rejects.toThrow();
  });

  it('accepts exactly twelve characters', async () => {
    const hash = await hashPassword('a'.repeat(12));

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword(VALID);

    await expect(verifyPassword(VALID, hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(VALID);

    await expect(verifyPassword('incorrect horse battery staple', hash)).resolves.toBe(false);
  });

  it('is case- and whitespace-sensitive', async () => {
    const hash = await hashPassword(VALID);

    await expect(verifyPassword(VALID.toUpperCase(), hash)).resolves.toBe(false);
    await expect(verifyPassword(`${VALID} `, hash)).resolves.toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    // A truncated or legacy row must fail this one login, not the endpoint.
    await expect(verifyPassword(VALID, 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword(VALID, '$argon2id$broken')).resolves.toBe(false);
  });

  it('returns false when either side is empty', async () => {
    const hash = await hashPassword(VALID);

    await expect(verifyPassword('', hash)).resolves.toBe(false);
    await expect(verifyPassword(VALID, '')).resolves.toBe(false);
  });

  it('does not accept a different password that shares a prefix', async () => {
    const hash = await hashPassword(VALID);

    await expect(verifyPassword(VALID.slice(0, -1), hash)).resolves.toBe(false);
  });
});
