import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  MIGRATION_PATH,
  renderLocationMigration,
} from '../../../scripts/generate-location-migration.ts';
import {
  acceptInvitationBodySchema,
  adjudicateClaimBodySchema,
  applyRbacCatalogueSchema,
  auditLogsQuerySchema,
  claimOptionalFacilityBodySchema,
  createFacilityAdminInvitationSchema,
  createFacilitySchema,
  createInvoiceBodySchema,
  createPatientBodySchema,
  createStaffInvitationBodySchema,
  createTenantSchema,
  draftClaimBodySchema,
  facilitiesListQuerySchema,
  facilityIdParamSchema,
  invitationIdParamSchema,
  invitationTokenQuerySchema,
  loginBodySchema,
  paginationQuerySchema,
  paymentLedgerQuerySchema,
  rbacRolesQuerySchema,
  recordPaymentBodySchema,
  roleIdParamSchema,
  scopedCollectionQuerySchema,
  slugFromTenantName,
  staffAccountStatusBodySchema,
  staffRoleAssignmentBodySchema,
  staffRoleIdParamSchema,
  staffRoleIdsBodySchema,
  staffRolePermissionsBodySchema,
  staffRoleRevocationBodySchema,
  staffUserIdParamSchema,
  tenantIdParamSchema,
  updateFacilitySchema,
  updatePatientBodySchema,
  updateRolePermissionsBodySchema,
  updateTenantSchema,
  voidInvoiceBodySchema,
} from '../../validation/schemas/index.ts';
import {
  formatValidationFailure,
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
  parseWithSchema,
  validateBody,
  validateParams,
  validateQuery,
} from '../../validation/validate.ts';

function mockResponse() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

describe('Route-level Zod validation middleware and domain schemas', () => {
  it('validates and normalizes tenant create and partial update payloads', () => {
    const created = parseWithSchema(createTenantSchema, {
      name: '  Nyeri County Referral Network  ',
      contactEmail: 'ADMIN@NYERIHEALTH.OR.KE ',
      brandColor: '#0f766e',
      logoUrl: 'https://cdn.nyerihealth.or.ke/logo.png',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.slug).toBe('nyeri-county-referral-network');
      expect(created.data.contactEmail).toBe('ADMIN@NYERIHEALTH.OR.KE');
      expect(created.data.currency).toBe('KES');
      expect(created.data.timezone).toBe('Africa/Nairobi');
    }

    expect(slugFromTenantName('St. Mary’s Hospital — Mumias!')).toBe('st-mary-s-hospital-mumias');

    const badSlug = parseWithSchema(createTenantSchema, {
      name: 'Valid Name',
      slug: 'INVALID SLUG!!',
    });
    expect(badSlug.ok).toBe(false);
    if (!badSlug.ok) {
      expect(badSlug.payload.error).toBe('VALIDATION_ERROR');
      expect(badSlug.payload.issues[0]?.path).toBe('slug');
    }

    const badLogo = parseWithSchema(createTenantSchema, {
      name: 'Valid Name',
      logoUrl: 'javascript:alert(1)',
    });
    expect(badLogo.ok).toBe(false);

    const emptyPatch = parseWithSchema(updateTenantSchema, {});
    expect(emptyPatch.ok).toBe(false);

    const validPatch = parseWithSchema(updateTenantSchema, {
      isActive: false,
      contactEmail: null,
      domain: 'portal.nyerihealth.or.ke',
    });
    expect(validPatch.ok).toBe(true);
    if (validPatch.ok) {
      expect(validPatch.data).toEqual({
        isActive: false,
        contactEmail: null,
        domain: 'portal.nyerihealth.or.ke',
      });
    }
  });

  it('validates facility create, partial update, and admin invitation payloads', () => {
    const created = parseWithSchema(createFacilitySchema, {
      tenantId: '4',
      code: ' ncrh-01 ',
      name: ' Nyeri County Referral Hospital ',
      level: 'Level 5',
      county: 'Nyeri',
      subCounty: 'Nyeri Town',
      email: 'INFO@NCRH.GO.KE',
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.tenantId).toBe(4);
      expect(created.data.code).toBe('NCRH-01');
      expect(created.data.email).toBe('info@ncrh.go.ke');
    }

    const rejectedCode = parseWithSchema(createFacilitySchema, {
      tenantId: 4,
      code: 'bad code!',
      name: 'Hospital',
    });
    expect(rejectedCode.ok).toBe(false);

    const rejectedTenantReassign = parseWithSchema(updateFacilitySchema, {
      tenantId: 99,
      name: 'Attempted Reassign',
    });
    expect(rejectedTenantReassign.ok).toBe(false);

    const countyOnlyUpdate = parseWithSchema(updateFacilitySchema, {
      county: 'Kisumu',
      isActive: true,
    });
    expect(countyOnlyUpdate.ok).toBe(true);
    if (countyOnlyUpdate.ok) {
      expect(countyOnlyUpdate.data).toEqual({
        county: 'Kisumu',
        isActive: true,
      });
    }

    const mismatchedLocationUpdate = parseWithSchema(updateFacilitySchema, {
      county: 'Kisumu',
      subCounty: 'Westlands',
    });
    expect(mismatchedLocationUpdate.ok).toBe(false);

    const validInvite = parseWithSchema(createFacilityAdminInvitationSchema, {
      facilityId: 12,
      fullName: 'Dr. Wanjiru Mwangi',
      email: 'WANJIRU@NCRH.GO.KE',
      phone: '+254700000001',
    });
    expect(validInvite.ok).toBe(true);
    if (validInvite.ok) {
      expect(validInvite.data.email).toBe('wanjiru@ncrh.go.ke');
    }

    expect(parseWithSchema(invitationIdParamSchema, { id: '0' }).ok).toBe(false);
    expect(parseWithSchema(facilityIdParamSchema, { id: '15' }).ok).toBe(true);
    expect(parseWithSchema(tenantIdParamSchema, { id: '-3' }).ok).toBe(false);
  });

  it('validates RBAC catalogue, override permissions, and staff role endpoints', () => {
    expect(parseWithSchema(rbacRolesQuerySchema, { facilityId: '10' }).ok).toBe(true);
    expect(parseWithSchema(rbacRolesQuerySchema, { facilityId: 'abc' }).ok).toBe(false);

    const applyValid = parseWithSchema(applyRbacCatalogueSchema, {
      facilityId: 10,
      roleNames: [' doctor ', 'NURSE', 'doctor'],
      topUpExisting: true,
    });
    expect(applyValid.ok).toBe(true);
    if (applyValid.ok) {
      expect(applyValid.data.roleNames).toEqual(['DOCTOR', 'NURSE']);
      expect(applyValid.data.topUpExisting).toBe(true);
    }

    expect(parseWithSchema(applyRbacCatalogueSchema, { facilityId: 10, roleNames: [] }).ok).toBe(
      false,
    );

    const duplicatePerms = parseWithSchema(updateRolePermissionsBodySchema, {
      facilityId: 10,
      permissionIds: [1, 2, 2],
    });
    expect(duplicatePerms.ok).toBe(false);

    const validPerms = parseWithSchema(updateRolePermissionsBodySchema, {
      facilityId: 10,
      permissionIds: [1, 5, 9],
    });
    expect(validPerms.ok).toBe(true);

    expect(parseWithSchema(roleIdParamSchema, { id: '7' }).ok).toBe(true);
    expect(parseWithSchema(staffUserIdParamSchema, { userId: '42' }).ok).toBe(true);
    expect(parseWithSchema(staffRoleIdParamSchema, { roleId: '0' }).ok).toBe(false);
    expect(parseWithSchema(staffRoleIdsBodySchema, { roleIds: [2, 3] }).ok).toBe(true);
    expect(parseWithSchema(staffRoleIdsBodySchema, { roleIds: ['bad'] }).ok).toBe(false);
    expect(parseWithSchema(staffRolePermissionsBodySchema, { permissionIds: [10, 11] }).ok).toBe(
      true,
    );
    expect(
      parseWithSchema(staffAccountStatusBodySchema, { active: true, reason: 'Returned' }).ok,
    ).toBe(true);
    expect(parseWithSchema(staffAccountStatusBodySchema, { active: false, reason: 123 }).ok).toBe(
      false,
    );
    expect(
      parseWithSchema(staffRoleAssignmentBodySchema, { roleName: 'NURSE', facilityId: 10 }).ok,
    ).toBe(true);
    expect(parseWithSchema(staffRoleRevocationBodySchema, { reason: 'Transferred' }).ok).toBe(true);
  });

  it('validates auth, bounded pagination, patient, invoice, payment, and claim schemas', () => {
    expect(
      parseWithSchema(loginBodySchema, {
        identifier: 'clinician@ hospital.ke',
        password: 'ValidPassword123!',
      }).ok,
    ).toBe(false);

    const validLogin = parseWithSchema(loginBodySchema, {
      identifier: '  clinician_01  ',
      password: 'ValidPassword123!',
    });
    expect(validLogin.ok).toBe(true);
    if (validLogin.ok) {
      expect(validLogin.data.identifier).toBe('clinician_01');
    }

    expect(parseWithSchema(loginBodySchema, { identifier: 'user', password: 'short' }).ok).toBe(
      false,
    );
    expect(parseWithSchema(invitationTokenQuerySchema, { token: 'a'.repeat(32) }).ok).toBe(true);
    expect(parseWithSchema(invitationTokenQuerySchema, { token: 'short' }).ok).toBe(false);

    expect(
      parseWithSchema(acceptInvitationBodySchema, {
        token: 'a'.repeat(32),
        username: 'nurse_jane',
        password: 'StrongPassword123!',
      }).ok,
    ).toBe(true);

    expect(
      parseWithSchema(createStaffInvitationBodySchema, {
        fullName: 'Jane Wambui',
        email: 'JANE@HOSPITAL.KE',
        roleId: '5',
      }).ok,
    ).toBe(true);

    // Bounded pagination rejects negative or oversized page/limit values
    const defaultPage = parseWithSchema(paginationQuerySchema, {});
    expect(defaultPage.ok).toBe(true);
    if (defaultPage.ok) {
      expect(defaultPage.data).toEqual({ limit: 50, offset: 0 });
    }
    expect(parseWithSchema(paginationQuerySchema, { limit: '9999' }).ok).toBe(false);
    expect(parseWithSchema(paginationQuerySchema, { offset: '-1' }).ok).toBe(false);

    expect(
      parseWithSchema(scopedCollectionQuerySchema, {
        tenantId: '1',
        facilityId: '2',
        search: 'Kamau',
        limit: '25',
      }).ok,
    ).toBe(true);

    expect(
      parseWithSchema(createPatientBodySchema, {
        firstName: 'Amina',
        lastName: 'Hassan',
        dateOfBirth: '1994-06-15',
        gender: 'Female',
        registrationFacilityId: 2,
      }).ok,
    ).toBe(true);
    expect(parseWithSchema(updatePatientBodySchema, {}).ok).toBe(false);
    expect(parseWithSchema(voidInvoiceBodySchema, { reason: 'Duplicate entry' }).ok).toBe(true);
    expect(parseWithSchema(recordPaymentBodySchema, { invoiceId: 9, amount: '1250.50' }).ok).toBe(
      true,
    );
    expect(parseWithSchema(recordPaymentBodySchema, { invoiceId: 9, amount: -10 }).ok).toBe(false);
    expect(parseWithSchema(paymentLedgerQuerySchema, { limit: '501' }).ok).toBe(false);
    expect(parseWithSchema(paymentLedgerQuerySchema, { limit: '100', facilityId: '2' }).ok).toBe(
      true,
    );
    expect(
      parseWithSchema(createInvoiceBodySchema, {
        invoice: { facilityId: 2, patientId: 11, invoiceNumber: 'INV-2026-001' },
        items: [
          { itemType: 'Consultation', description: 'OPD Review', quantity: 1, unitPrice: 500 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      parseWithSchema(createInvoiceBodySchema, {
        invoice: { facilityId: 2, patientId: 11, invoiceNumber: 'INV-2026-001' },
        items: [],
      }).ok,
    ).toBe(false);
    expect(parseWithSchema(draftClaimBodySchema, { invoiceId: 14 }).ok).toBe(true);
    expect(parseWithSchema(adjudicateClaimBodySchema, { approvedAmount: '4500.00' }).ok).toBe(true);
    expect(parseWithSchema(adjudicateClaimBodySchema, { approvedAmount: -1 }).ok).toBe(false);
    expect(parseWithSchema(facilitiesListQuerySchema, { tenantId: '2' }).ok).toBe(true);
    expect(parseWithSchema(auditLogsQuerySchema, { facilityId: '0' }).ok).toBe(false);
    expect(parseWithSchema(claimOptionalFacilityBodySchema, { facilityId: 2 }).ok).toBe(true);
  });

  it('enforces safe VALIDATION_ERROR envelopes in Express middleware without leaking internals', () => {
    const leakySchema = z.object({
      secret: z.string().refine(() => false, {
        message: 'SELECT password_hash FROM users WHERE token = Bearer eyJhbGciOiJIUzI1NiJ9',
      }),
    });

    const parsed = leakySchema.safeParse({ secret: 'x' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const formatted = formatValidationFailure(parsed.error, {
        fallbackMessage: 'Invalid request field.',
      });
      expect(formatted.error).toBe('VALIDATION_ERROR');
      expect(formatted.message).toBe('Invalid request field.');
      expect(JSON.stringify(formatted)).not.toContain('SELECT');
      expect(JSON.stringify(formatted)).not.toContain('Bearer');
    }

    // Non-object JSON array body is rejected cleanly with 400 VALIDATION_ERROR
    const bodyMw = validateBody(z.object({ optionalField: z.string().optional() }));
    const res1 = mockResponse();
    const next1 = vi.fn();
    bodyMw({ body: ['unexpected', 'array'] } as any, res1 as any, next1);
    expect(res1.statusCode).toBe(400);
    expect(res1.payload).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Request body must be a JSON object.',
    });
    expect(next1).not.toHaveBeenCalled();

    // Valid body, query, and params populate typed getters
    const reqOk = {
      body: { optionalField: 'clean' },
      query: { facilityId: '8' },
      params: { id: '21' },
    } as any;
    const resOk = mockResponse();
    const nextOk = vi.fn();

    bodyMw(reqOk, resOk as any, nextOk);
    validateQuery(rbacRolesQuerySchema)(reqOk, resOk as any, nextOk);
    validateParams(facilityIdParamSchema)(reqOk, resOk as any, nextOk);

    expect(nextOk).toHaveBeenCalledTimes(3);
    expect(getValidatedBody(reqOk)).toEqual({ optionalField: 'clean' });
    expect(getValidatedQuery(reqOk)).toEqual({ facilityId: 8 });
    expect(getValidatedParams(reqOk)).toEqual({ id: 21 });
  });

  it('preserves historical migration 0023_normalise_county_subcounty.sql checksum and generator parity', () => {
    const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');

    expect(sha256).toBe('a46e92fdc5ed63e4c47a0f4f76dc2f47d3e5195edb033f2568646d8e5a34b49c');
    expect(sql).toBe(renderLocationMigration());
  });
});
