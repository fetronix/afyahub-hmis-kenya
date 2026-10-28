import { z } from 'zod';

import { parsePositiveIntValue, positiveIntField } from './common.schema.ts';

export const rbacRolesQuerySchema = z.object({
  facilityId: positiveIntField('A valid facilityId query parameter is required.'),
});

export const roleIdParamSchema = z.object({
  id: positiveIntField('A valid role ID is required.'),
});

export interface ApplyRbacCatalogueValidated {
  facilityId: number;
  roleNames: string[] | null;
  topUpExisting: boolean;
}

export const applyRbacCatalogueSchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): ApplyRbacCatalogueValidated => {
    const facilityId = parsePositiveIntValue(body.facilityId);
    if (facilityId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['facilityId'],
        message: 'A valid facilityId is required.',
      });
      return z.NEVER;
    }

    let roleNames: string[] | null = null;
    if (body.roleNames !== undefined) {
      if (
        !Array.isArray(body.roleNames) ||
        body.roleNames.length === 0 ||
        body.roleNames.length > 100 ||
        body.roleNames.some((name) => typeof name !== 'string' || name.trim().length === 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['roleNames'],
          message: 'roleNames must be an array of catalogue role names.',
        });
        return z.NEVER;
      }
      roleNames = [...new Set(body.roleNames.map((name) => name.trim().toUpperCase()))];
    }

    return {
      facilityId,
      roleNames,
      topUpExisting: body.topUpExisting === true,
    };
  });

export interface UpdateRolePermissionsValidated {
  facilityId: number;
  permissionIds: number[];
}

export const updateRolePermissionsBodySchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): UpdateRolePermissionsValidated => {
    const facilityId = parsePositiveIntValue(body.facilityId);
    if (facilityId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['facilityId'],
        message: 'A valid facilityId is required.',
      });
      return z.NEVER;
    }

    const rawIds = body.permissionIds;
    if (
      !Array.isArray(rawIds) ||
      rawIds.length > 500 ||
      rawIds.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissionIds'],
        message: 'permissionIds must be an array of positive integer IDs.',
      });
      return z.NEVER;
    }

    const uniqueIds = [...new Set(rawIds as number[])];
    if (uniqueIds.length !== rawIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissionIds'],
        message: 'Each permission may only be selected once.',
      });
      return z.NEVER;
    }

    return {
      facilityId,
      permissionIds: uniqueIds,
    };
  });

export const staffRoleAssignmentBodySchema = z.object({
  roleName: z
    .string({ message: 'roleName is required.' })
    .trim()
    .min(1, 'roleName is required.')
    .max(100, 'roleName must not exceed 100 characters.'),
  facilityId: z
    .unknown()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === null) return undefined;
      const parsed = parsePositiveIntValue(val);
      if (parsed === null) {
        ctx.addIssue({ code: 'custom', message: 'facilityId must be a positive integer.' });
        return z.NEVER;
      }
      return parsed;
    }),
  isPrimary: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const staffRoleRevocationBodySchema = z.object({
  reason: z.string().trim().max(500, 'reason must not exceed 500 characters.').optional(),
});

export const staffUserIdParamSchema = z.object({
  userId: positiveIntField('A valid staff account is required.'),
});

export const staffRoleIdParamSchema = z.object({
  roleId: positiveIntField('A valid role is required.'),
});

export const staffRoleIdsBodySchema = z.object({
  roleIds: z.unknown().transform((val, ctx): number[] => {
    if (
      !Array.isArray(val) ||
      val.length > 100 ||
      val.some((id) => parsePositiveIntValue(id) === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'roleIds must be an array of role identifiers.',
      });
      return z.NEVER;
    }
    return val.map((id) => parsePositiveIntValue(id)!);
  }),
});

export const staffRolePermissionsBodySchema = z.object({
  permissionIds: z.unknown().transform((val, ctx): number[] => {
    if (
      !Array.isArray(val) ||
      val.length > 500 ||
      val.some((id) => parsePositiveIntValue(id) === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'permissionIds must be an array of permission identifiers.',
      });
      return z.NEVER;
    }
    return val.map((id) => parsePositiveIntValue(id)!);
  }),
});

export const staffAccountStatusBodySchema = z
  .record(z.string(), z.unknown())
  .transform((body, ctx): { active: boolean; reason: string | null } => {
    if (typeof body.active !== 'boolean') {
      ctx.addIssue({
        code: 'custom',
        path: ['active'],
        message: 'active must be true or false.',
      });
      return z.NEVER;
    }

    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason must be text.',
      });
      return z.NEVER;
    }

    if (typeof body.reason === 'string' && body.reason.length > 500) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason must not exceed 500 characters.',
      });
      return z.NEVER;
    }

    return {
      active: body.active,
      reason: typeof body.reason === 'string' ? body.reason : null,
    };
  });
