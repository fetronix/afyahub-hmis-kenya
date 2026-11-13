import { z } from 'zod';

export interface LoginBodyValidated {
  identifier: string;
  password: string;
}

export const loginBodySchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): LoginBodyValidated => {
    const rawIdentifier = body.identifier;
    if (typeof rawIdentifier !== 'string' || rawIdentifier.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: 'Username or email is required.',
      });
      return z.NEVER;
    }

    const identifier = rawIdentifier.trim().toLowerCase();
    if (identifier.length > 254) {
      ctx.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: 'Username or email is invalid.',
      });
      return z.NEVER;
    }

    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F\s]/.test(identifier)) {
      ctx.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: 'Username or email contains invalid characters.',
      });
      return z.NEVER;
    }

    const rawPassword = body.password;
    if (typeof rawPassword !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password is required.',
      });
      return z.NEVER;
    }

    if (rawPassword.length < 12) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must be at least 12 characters long.',
      });
      return z.NEVER;
    }

    if (rawPassword.length > 128) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must not exceed 128 characters.',
      });
      return z.NEVER;
    }

    if (rawPassword.includes('\u0000')) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password contains invalid characters.',
      });
      return z.NEVER;
    }

    return {
      identifier,
      password: rawPassword,
    };
  });

export const invitationTokenQuerySchema = z.object({
  token: z
    .string({ message: 'Invitation token is required.' })
    .trim()
    .min(16, 'Invitation token is invalid.')
    .max(512, 'Invitation token is invalid.'),
});

export const acceptInvitationBodySchema = z.object({
  token: z
    .string({ message: 'Invitation token is required.' })
    .trim()
    .min(16, 'Invitation token is invalid.')
    .max(512, 'Invitation token is invalid.'),
  username: z
    .string({ message: 'Username is required.' })
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(80, 'Username must not exceed 80 characters.'),
  password: z
    .string({ message: 'Password is required.' })
    .min(12, 'Password must be at least 12 characters long.')
    .max(128, 'Password must not exceed 128 characters.'),
});

export const createStaffInvitationBodySchema = z
  .object({
    fullName: z
      .string({ message: 'Email, full name, and a valid role are required.' })
      .trim()
      .min(1)
      .max(200),
    email: z
      .string({ message: 'Email, full name, and a valid role are required.' })
      .trim()
      .toLowerCase()
      .max(254)
      .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: 'Provide a valid staff email address.',
      }),
    roleId: z
      .unknown()
      .refine(
        (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0,
        'Email, full name, and a valid role are required.',
      )
      .transform((v) => Number(v)),
    credentialId: z.unknown().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    designation: z.string().trim().max(120).nullable().optional(),
  })
  .passthrough();
